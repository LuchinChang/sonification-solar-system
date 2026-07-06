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
 */
export function revealLineFraction(tFrac: number, guidedTimeFrac: number): number {
  if (guidedTimeFrac <= 0 || guidedTimeFrac >= 1) return Math.min(Math.max(tFrac, 0), 1);
  if (tFrac <= guidedTimeFrac) {
    return (tFrac / guidedTimeFrac) * GUIDED_LINE_FRACTION;
  }
  const u = (tFrac - guidedTimeFrac) / (1 - guidedTimeFrac);
  return GUIDED_LINE_FRACTION + (1 - GUIDED_LINE_FRACTION) * u * u;
}

/** Planet-disc opacity: 1 through the guided phase, fading out early in completion. */
export function planetDiscAlpha(tFrac: number, guidedTimeFrac: number): number {
  if (tFrac <= guidedTimeFrac) return 1;
  const u = (tFrac - guidedTimeFrac) / (1 - guidedTimeFrac);
  return Math.max(0, 1 - u / PLANET_FADE_FRACTION);
}
