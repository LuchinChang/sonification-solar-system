// src/engine.ts
//
// Pure functions extracted from main.ts for testability.
// No DOM, no Canvas, no Audio — just math and data.

import type { Point } from './geometry';
import { ELEMENTS, type KeplerianElements } from './orbital-elements';

export type LinkLine = { p1: Point; p2: Point };

const DEG2RAD = Math.PI / 180;

/**
 * Pre-calculate Earth–Venus link lines for a given orbital configuration.
 * Returns one line per sample: Earth position → Venus position at that time step.
 */
export function calculateLines(
  cx: number,
  cy: number,
  sampleRate: number,
  earthR: number,
  venusR: number,
  earthPeriod: number,
  venusPeriod: number,
  simYears: number,
): LinkLine[] {
  const lines: LinkLine[] = [];
  const totalDays = simYears * earthPeriod;

  for (let i = 0; i < sampleRate; i++) {
    const t  = (i / sampleRate) * totalDays;
    const ea = (t / earthPeriod) * 2 * Math.PI;
    const va = (t / venusPeriod) * 2 * Math.PI;
    lines.push({
      p1: { x: cx + earthR * Math.cos(ea), y: cy + earthR * Math.sin(ea) },
      p2: { x: cx + venusR * Math.cos(va), y: cy + venusR * Math.sin(va) },
    });
  }
  return lines;
}

/**
 * Solve Kepler's equation M = E - e·sin(E) for eccentric anomaly E
 * using Newton-Raphson iteration.
 */
export function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 15; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

/**
 * Compute a planet's heliocentric ecliptic (x, y) position at time T
 * (Julian centuries past J2000.0) using JPL's 6-step algorithm.
 * Returns position in AU.
 */
function helioEcliptic(el: KeplerianElements, T: number): { x: number; y: number } {
  // Step 1: compute elements at time T
  const a     = el.a     + el.aDot     * T;
  const e     = el.e     + el.eDot     * T;
  const I     = (el.I     + el.IDot     * T) * DEG2RAD;
  const L     = (el.L     + el.LDot     * T) * DEG2RAD;
  const wbar  = (el.wbar  + el.wbarDot  * T) * DEG2RAD;
  const Omega = (el.Omega + el.OmegaDot * T) * DEG2RAD;

  // Step 2: argument of perihelion and mean anomaly
  const omega = wbar - Omega;
  let M = L - wbar;
  // Normalize M to [-π, π]
  M = M % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;

  // Step 3: solve Kepler's equation
  const E = solveKepler(M, e);

  // Step 4: heliocentric orbital-plane coordinates
  const xPrime = a * (Math.cos(E) - e);
  const yPrime = a * Math.sqrt(1 - e * e) * Math.sin(E);

  // Step 5: rotate to ecliptic coordinates
  // r_ecl = R_z(-Omega) · R_x(-I) · R_z(-omega) · [x', y', 0]
  const cosO = Math.cos(omega);
  const sinO = Math.sin(omega);
  const cosI = Math.cos(I);
  const sinI = Math.sin(I);
  const cosN = Math.cos(Omega);
  const sinN = Math.sin(Omega);

  // Apply R_z(-omega)
  const x1 =  cosO * xPrime + sinO * yPrime;
  const y1 = -sinO * xPrime + cosO * yPrime;
  const z1 = 0;

  // Apply R_x(-I)
  const x2 = x1;
  const y2 = cosI * y1 - sinI * z1;
  const z2 = sinI * y1 + cosI * z1;

  // Apply R_z(-Omega)
  const xEcl = cosN * x2 + sinN * y2;
  const yEcl = -sinN * x2 + cosN * y2;
  // zEcl = z2; // dropped for 2D projection

  void z2; // unused — we project to 2D
  return { x: xEcl, y: yEcl };
}

/**
 * Calculate link lines using NASA JPL Keplerian elements for elliptical orbits.
 * Each line connects planet1's position to planet2's position at the same time.
 */
export function calculateEllipticalLines(
  cx: number,
  cy: number,
  sampleRate: number,
  planet1Key: string,
  planet2Key: string,
  simYears: number,
  auScale: number,
): LinkLine[] {
  const el1 = ELEMENTS[planet1Key];
  const el2 = ELEMENTS[planet2Key];
  if (!el1 || !el2) {
    throw new Error(`Unknown planet key: ${!el1 ? planet1Key : planet2Key}`);
  }

  const lines: LinkLine[] = [];
  const totalDays = simYears * 365.25;

  for (let i = 0; i < sampleRate; i++) {
    const t = (i / sampleRate) * totalDays;
    const T = t / 36525; // Julian centuries past J2000.0

    const pos1 = helioEcliptic(el1, T);
    const pos2 = helioEcliptic(el2, T);

    lines.push({
      p1: { x: cx + pos1.x * auScale, y: cy - pos1.y * auScale },
      p2: { x: cx + pos2.x * auScale, y: cy - pos2.y * auScale },
    });
  }
  return lines;
}

/**
 * Calculate geocentric link lines (Earth at center).
 * The Sun orbits circularly; the Moon follows an elliptical orbit
 * with a precessing argument of perigee.
 */
export function calculateGeocentricLines(
  cx: number,
  cy: number,
  sampleRate: number,
  outerR: number,
  innerR: number,
  outerPeriod: number,
  innerPeriod: number,
  simYears: number,
  eccentricity: number,
  precessionPeriodYears: number,
): LinkLine[] {
  const lines: LinkLine[] = [];
  const totalDays = simYears * 365.25;
  const precessionRate = (2 * Math.PI) / (precessionPeriodYears * 365.25);

  for (let i = 0; i < sampleRate; i++) {
    const t = (i / sampleRate) * totalDays;

    // Sun: circular geocentric orbit
    const sunAngle = (t / outerPeriod) * 2 * Math.PI;
    const p1 = {
      x: cx + outerR * Math.cos(sunAngle),
      y: cy + outerR * Math.sin(sunAngle),
    };

    // Moon: elliptical orbit with precessing perigee
    const M = (t / innerPeriod) * 2 * Math.PI;
    const E = solveKepler(M, eccentricity);
    const trueAnomaly = 2 * Math.atan2(
      Math.sqrt(1 + eccentricity) * Math.sin(E / 2),
      Math.sqrt(1 - eccentricity) * Math.cos(E / 2),
    );
    const r = innerR * (1 - eccentricity * Math.cos(E));
    const omega = precessionRate * t;
    const angle = trueAnomaly + omega;
    const p2 = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };

    lines.push({ p1, p2 });
  }
  return lines;
}

// ─── Moon–Earth stroboscopic hexagon ──────────────────────────────
//
// Reproduces the "lunar hexagon" from Hartmut Warm's *Signature of the
// Celestial Spheres*. The Moon's geocentric position is sampled once per
// "Sun-Earth-View" — the synodic solar-rotation period, 27.275 days — and
// consecutive samples are connected. Each sample the Moon's longitude
// regresses ≈0.62° (beat vs the sidereal month) while its distance phase
// regresses ≈3.65° (beat vs the anomalistic month); the distance therefore
// completes ≈6 cycles per longitude revolution → six lobes → a hexagon.
// A *dense* trace would smear into a ring; the hexagon exists only at the
// 27.275-day strobe interval.

/** Synodic solar-rotation period ("Sun-Earth-View" interval), in days. */
export const SOLAR_SYNODIC_ROTATION_DAYS = 27.275;

/** Lunar orbit inclination to the ecliptic, degrees. */
export const MOON_INCLINATION_DEG = 5.145;
/** Nodal regression period (line of nodes), years — retrograde. */
export const MOON_NODAL_PERIOD_YEARS = 18.6;
/**
 * Ecliptic-latitude limit (degrees) below which a syzygy counts as an eclipse.
 * Real eclipses require the Moon near a node at New/Full Moon; ~0.9° keeps the
 * set sparse (a few per year) so the markers read as discrete points on the
 * hexagon rather than filling the annulus.
 */
export const ECLIPSE_LAT_LIMIT_DEG = 0.9;

/** A true Sun-Earth-Moon alignment: `solar` = New Moon eclipse, `lunar` = Full Moon eclipse. */
export type EclipseDot = { x: number; y: number; atProgress: number; kind: 'solar' | 'lunar' };

/**
 * Moon geocentric position at time `t` (days), inertial frame.
 * Mean anomaly advances at the anomalistic rate and the line of apsides
 * precesses at the apsidal rate, so the longitude (ν + ω) advances at the
 * sidereal rate (1/T_anom + 1/T_apsidal = 1/T_sidereal). Returns canvas
 * coords plus radius `r`, ecliptic longitude `lambda`, and mean anomaly `M`.
 */
function moonPosAt(
  cx: number,
  cy: number,
  t: number,
  a: number,
  e: number,
  anomMonth: number,
  apsidalDays: number,
): { x: number; y: number; r: number; lambda: number } {
  const M = (t / anomMonth) * 2 * Math.PI;
  const E = solveKepler(M, e);
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2),
  );
  const r = a * (1 - e * Math.cos(E));
  const omega = (t / apsidalDays) * 2 * Math.PI;
  const lambda = nu + omega;
  return { x: cx + r * Math.cos(lambda), y: cy + r * Math.sin(lambda), r, lambda };
}

/**
 * Stroboscopic Moon hexagon: `sampleCount` Moon positions taken every
 * `viewDays` (default 27.275 d), connected as a polyline. These segments are
 * the pattern's link lines — sweepers probe them like any other pattern.
 */
export function calculateMoonHexagonLines(
  cx: number,
  cy: number,
  sampleCount: number,
  a: number,
  e: number,
  anomMonth: number,
  apsidalDays: number,
  viewDays: number = SOLAR_SYNODIC_ROTATION_DAYS,
): LinkLine[] {
  const lines: LinkLine[] = [];
  let prev = moonPosAt(cx, cy, 0, a, e, anomMonth, apsidalDays);
  for (let n = 1; n <= sampleCount; n++) {
    const cur = moonPosAt(cx, cy, n * viewDays, a, e, anomMonth, apsidalDays);
    lines.push({ p1: { x: prev.x, y: prev.y }, p2: { x: cur.x, y: cur.y } });
    prev = cur;
  }
  return lines;
}

/**
 * Find eclipse dots over `[0, totalDays]`: true Sun-Earth-Moon alignments.
 *
 * A syzygy (sign-flip of sin(λ_moon − λ_sun)) only produces an eclipse when the
 * Moon is also near a node — i.e. its ecliptic latitude β = i·sin(λ_moon − Ω)
 * is small, where the node longitude Ω regresses with an 18.6-year period.
 * `kind` is `solar` at New Moon (cos(λ_moon − λ_sun) > 0) or `lunar` at Full
 * Moon. Dots carry `atProgress` (0..1) so they reveal in sync with the draw-in.
 *
 * The result is naturally sparse (a handful per year), so the markers read as
 * discrete points on the hexagon rather than filling the annulus — matching the
 * reference figure.
 */
export function calculateMoonEclipses(
  cx: number,
  cy: number,
  totalDays: number,
  a: number,
  e: number,
  anomMonth: number,
  apsidalDays: number,
  sunYearDays: number = 365.2422,
  nodalPeriodYears: number = MOON_NODAL_PERIOD_YEARS,
  latLimitDeg: number = ECLIPSE_LAT_LIMIT_DEG,
  fineStepDays: number = 0.25,
): EclipseDot[] {
  const dots: EclipseDot[] = [];
  const steps = Math.max(2, Math.ceil(totalDays / fineStepDays));
  const nodalDays = nodalPeriodYears * 365.25;
  const incl = MOON_INCLINATION_DEG * (Math.PI / 180);
  const latLimit = latLimitDeg * (Math.PI / 180);

  const sample = (i: number) => {
    const t = (i / steps) * totalDays;
    const m = moonPosAt(cx, cy, t, a, e, anomMonth, apsidalDays);
    const sunLambda = (t / sunYearDays) * 2 * Math.PI;
    return { m, t, dSyz: m.lambda - sunLambda, syz: Math.sin(m.lambda - sunLambda) };
  };

  let prev = sample(0);
  for (let i = 1; i <= steps; i++) {
    const cur = sample(i);
    // Syzygy: sin(λ_moon − λ_sun) crosses zero between samples.
    if (prev.syz * cur.syz < 0) {
      // Moon's ecliptic latitude at the crossing (node Ω regresses over 18.6 yr).
      const omegaNode = -(cur.t / nodalDays) * 2 * Math.PI;
      const beta = Math.asin(Math.sin(incl) * Math.sin(cur.m.lambda - omegaNode));
      if (Math.abs(beta) < latLimit) {
        const kind: EclipseDot['kind'] = Math.cos(cur.dSyz) > 0 ? 'solar' : 'lunar';
        dots.push({ x: cur.m.x, y: cur.m.y, atProgress: cur.t / totalDays, kind });
      }
    }
    prev = cur;
  }
  return dots;
}

/**
 * Calculate cardioid (multiplication-table-on-a-circle) link lines.
 *
 * Place N evenly-spaced points around a circle of radius `radius` centered
 * at (cx, cy). For each point i, draw a chord from i to (i * n) mod N.
 *
 * - n = 2 produces a cardioid
 * - n = 3 produces a nephroid
 * - n >= 5 produces increasingly intricate epicycloids
 *
 * Sample rate equals N: every chord becomes one segment in `state.linkLines`,
 * so sweepers probing this pattern hear N intersection-cluster ticks per cycle.
 */
export function calculateCardioidLines(
  cx: number,
  cy: number,
  N: number,
  n: number,
  radius: number,
): LinkLine[] {
  if (N <= 0) return [];
  const pts: Point[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const theta = (2 * Math.PI * i) / N;
    pts[i] = { x: cx + radius * Math.cos(theta), y: cy + radius * Math.sin(theta) };
  }
  const m = ((n % N) + N) % N;
  const lines: LinkLine[] = new Array(N);
  for (let i = 0; i < N; i++) {
    lines[i] = { p1: pts[i], p2: pts[(i * m) % N] };
  }
  return lines;
}

/** Clamp a value to [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
