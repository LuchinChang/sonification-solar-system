// src/reveal.ts
//
// Reveal timing math (pure — no DOM). The Reveal is the one-time educational
// drawing of a newly applied pattern (CONTEXT.md): a slow GUIDED phase where
// the planet bodies visibly stamp each link line, then an accelerating
// COMPLETION phase where the figure finishes and the planet discs fade out.
//
// All functions take tFrac = elapsed/duration (0..1, the same value stored in
// state.drawAnimProgress) and guidedTimeFrac = GUIDED_PHASE_MS/durationMs.
// Captions stay keyed on tFrac, so authored caption timings are unaffected.

/** Wall-clock length of the guided phase. */
export const GUIDED_PHASE_MS = 7000;

/** Fraction of the pattern's lines revealed during the guided phase. */
export const GUIDED_LINE_FRACTION = 0.12;

/** Portion of the completion phase over which the planet discs fade out. */
export const PLANET_FADE_FRACTION = 0.2;

/** Reveals shorter than this can't fit a guided phase + a visible completion. */
export const MIN_REVEAL_MS = GUIDED_PHASE_MS + 4000;

/** Total Reveal duration: legacy formula with a floor for very short patterns. */
export function revealDurationMs(simYears: number): number {
  return Math.max(Math.min(simYears * 1500, 25000), MIN_REVEAL_MS);
}

/**
 * Fraction of lines to draw at time-fraction tFrac.
 * Guided phase: linear crawl to GUIDED_LINE_FRACTION.
 * Completion phase: quadratic ease-in over the remaining lines (starts slow,
 * accelerates — the deliberate "then it speeds up" beat).
 *
 * Total over all inputs: tFrac is clamped to [0, 1] at entry, so the result
 * is always in [0, 1] in BOTH branches (without the clamp, tFrac > 1 in the
 * completion branch would overshoot 1). A degenerate guidedTimeFrac (<= 0 or
 * >= 1) falls back to the linear identity curve.
 */
export function revealLineFraction(tFrac: number, guidedTimeFrac: number): number {
  tFrac = Math.min(Math.max(tFrac, 0), 1);
  if (guidedTimeFrac <= 0 || guidedTimeFrac >= 1) return tFrac;
  if (tFrac <= guidedTimeFrac) {
    return (tFrac / guidedTimeFrac) * GUIDED_LINE_FRACTION;
  }
  const u = (tFrac - guidedTimeFrac) / (1 - guidedTimeFrac);
  return GUIDED_LINE_FRACTION + (1 - GUIDED_LINE_FRACTION) * u * u;
}

/**
 * Planet-disc opacity: 1 through the guided phase, fading out early in
 * completion.
 *
 * Total over all inputs: tFrac is clamped to [0, 1] at entry, and the result
 * is always in [0, 1]. Degenerate guidedTimeFrac contract — guards the
 * division by (1 - guidedTimeFrac):
 *   guidedTimeFrac <= 0 → no guided phase at all → discs never shown (0).
 *   guidedTimeFrac >= 1 → the whole (clamped) timeline sits inside the
 *   guided phase → discs stay opaque (1).
 */
export function planetDiscAlpha(tFrac: number, guidedTimeFrac: number): number {
  tFrac = Math.min(Math.max(tFrac, 0), 1);
  if (guidedTimeFrac <= 0) return 0;
  if (guidedTimeFrac >= 1) return 1;
  if (tFrac <= guidedTimeFrac) return 1;
  const u = (tFrac - guidedTimeFrac) / (1 - guidedTimeFrac);
  return Math.max(0, 1 - u / PLANET_FADE_FRACTION);
}
