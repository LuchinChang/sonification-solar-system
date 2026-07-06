// src/pattern-generator.ts
//
// Hybrid Curated/Computed pattern model — see ADR 0002 and CONTEXT.md.
// Any valid inner/outer planet pair produces a playable pattern: pairs that
// match the authored catalogue return the Curated Pattern (name, tuned
// simYears, caption script); every other pair gets a Computed Pattern derived
// from JPL orbital elements. Pure module — no DOM.

import { ELEMENTS } from './orbital-elements';
import { PATTERNS, type PlanetaryPattern, type PatternCaption } from './patterns';

/** All 8 planets, sorted by semi-major axis (the selector's column order). */
export const PLANET_ORDER: readonly string[] = [
  'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
];

/** Sidereal period in days from the JPL mean-longitude rate (deg/century). */
export function periodDays(planetKey: string): number {
  const el = ELEMENTS[planetKey];
  if (!el) throw new Error(`Unknown planet: ${planetKey}`);
  return (360 / el.LDot) * 36525;
}

export interface PairResonance {
  innerOrbits: number;  // k — orbits the inner planet completes
  outerOrbits: number;  // m — orbits the outer planet completes
  simYears: number;     // m outer periods, in years
  petals: number;       // k − m, the flower's petal count
}

/** Search cap: how many outer-planet orbits we're willing to wait for closure. */
export const MAX_OUTER_ORBITS = 20;
/** An m:k pair closer than this (relative error per outer orbit) is "closed". */
export const RESONANCE_TOLERANCE = 0.02;

/**
 * Find the smallest near-resonance m:k ≈ 1 : Pout/Pin. Takes the first m whose
 * rounding error is inside tolerance (favouring short, watchable cycles);
 * falls back to the best error found if nothing closes within the cap.
 */
export function computeResonance(periodInnerDays: number, periodOuterDays: number): PairResonance {
  const ratio = periodOuterDays / periodInnerDays;
  let best = { m: 1, k: Math.max(2, Math.round(ratio)), err: Infinity };
  for (let m = 1; m <= MAX_OUTER_ORBITS; m++) {
    const k = Math.round(m * ratio);
    if (k <= m) continue;
    const err = Math.abs(m * ratio - k) / m;
    if (err < RESONANCE_TOLERANCE) { best = { m, k, err }; break; }
    if (err < best.err) best = { m, k, err };
  }
  const rawYears = (best.m * periodOuterDays) / 365.25;
  const simYears = Math.round(Math.min(Math.max(rawYears, 1), 100) * 100) / 100;
  return { innerOrbits: best.k, outerOrbits: best.m, simYears, petals: best.k - best.m };
}

function computedCaptions(inner: string, outer: string, r: PairResonance): PatternCaption[] {
  return [
    { atProgress: 0.00, text: `${inner} and ${outer} begin their dance...`, duration: 4 },
    { atProgress: 0.15, text: 'A line connects the two planets at each moment in time.', duration: 5 },
    { atProgress: 0.35, text: `${inner} completes ${r.innerOrbits} orbits while ${outer} completes ${r.outerOrbits}.`, duration: 5 },
    { atProgress: 0.60, text: `Together they trace a ${r.petals}-petaled figure.`, duration: 5 },
    { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
  ];
}

/** Stable id for a computed pair — parseable back by patternFromId. */
export function pairId(inner: string, outer: string): string {
  return `pair-${inner.toLowerCase()}-${outer.toLowerCase()}`;
}

/**
 * Resolve a planet pair to its Pattern. Curated pairs return the catalogue
 * object itself (identity matters: applyPattern compares ids); all other
 * valid pairs get a freshly computed pattern.
 */
export function getPatternForPair(inner: string, outer: string): PlanetaryPattern {
  const aIn = ELEMENTS[inner]?.a;
  const aOut = ELEMENTS[outer]?.a;
  if (aIn === undefined) throw new Error(`Unknown planet: ${inner}`);
  if (aOut === undefined) throw new Error(`Unknown planet: ${outer}`);
  if (aIn >= aOut) throw new Error(`${inner} is not inside ${outer}'s orbit`);

  const curated = PATTERNS.find(p =>
    (p.kind ?? 'planet') === 'planet' && !p.geocentric
    && p.planet1 === inner && p.planet2 === outer);
  if (curated) return curated;

  const pIn = periodDays(inner);
  const pOut = periodDays(outer);
  const res = computeResonance(pIn, pOut);
  return {
    id: pairId(inner, outer),
    name: `${inner} – ${outer}`,
    planet1: inner,
    planet2: outer,
    au1: aIn,
    au2: aOut,
    period1: pIn,
    period2: pOut,
    simYears: res.simYears,
    petals: res.petals,
    captions: computedCaptions(inner, outer, res),
  };
}

/**
 * Resolve any pattern id — catalogue or computed pair — used by the config
 * snapshot restore path so saved computed patterns reload.
 */
export function patternFromId(id: string): PlanetaryPattern | null {
  const catalogued = PATTERNS.find(p => p.id === id);
  if (catalogued) return catalogued;
  const m = /^pair-([a-z]+)-([a-z]+)$/.exec(id);
  if (!m) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  try {
    return getPatternForPair(cap(m[1]), cap(m[2]));
  } catch {
    return null;
  }
}
