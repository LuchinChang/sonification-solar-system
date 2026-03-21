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

/** Clamp a value to [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
