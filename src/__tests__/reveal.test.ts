// src/__tests__/reveal.test.ts
//
// Tests for the two-phase Reveal timing math (see CONTEXT.md "Reveal"):
// a slow guided phase revealing GUIDED_LINE_FRACTION of the lines, then an
// accelerating completion phase.

import { describe, it, expect } from 'vitest';
import {
  GUIDED_PHASE_MS, GUIDED_LINE_FRACTION, MIN_REVEAL_MS, PLANET_FADE_FRACTION,
  revealDurationMs, revealLineFraction, planetDiscAlpha,
} from '../reveal';

describe('revealDurationMs', () => {
  it('keeps the legacy formula for long patterns (simYears*1500 capped at 25s)', () => {
    expect(revealDurationMs(84)).toBe(25000);
    expect(revealDurationMs(12)).toBe(18000);
  });

  it('never returns less than the guided phase plus a completion window', () => {
    expect(revealDurationMs(1)).toBe(MIN_REVEAL_MS);
    expect(MIN_REVEAL_MS).toBeGreaterThan(GUIDED_PHASE_MS);
  });
});

describe('revealLineFraction', () => {
  const gf = GUIDED_PHASE_MS / revealDurationMs(8); // venus-earth: 12000ms total

  it('is 0 at the start and 1 at the end', () => {
    expect(revealLineFraction(0, gf)).toBe(0);
    expect(revealLineFraction(1, gf)).toBeCloseTo(1, 10);
  });

  it('reveals exactly GUIDED_LINE_FRACTION at the guided/completion boundary', () => {
    expect(revealLineFraction(gf, gf)).toBeCloseTo(GUIDED_LINE_FRACTION, 10);
  });

  it('is linear (slow) inside the guided phase', () => {
    expect(revealLineFraction(gf / 2, gf)).toBeCloseTo(GUIDED_LINE_FRACTION / 2, 10);
  });

  it('is monotonically non-decreasing across the whole timeline', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = revealLineFraction(Math.min(t, 1), gf);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('accelerates in the completion phase (second half reveals more than first half)', () => {
    const mid = gf + (1 - gf) / 2;
    const firstHalf = revealLineFraction(mid, gf) - revealLineFraction(gf, gf);
    const secondHalf = revealLineFraction(1, gf) - revealLineFraction(mid, gf);
    expect(secondHalf).toBeGreaterThan(firstHalf);
  });

  it('is total: clamps to [0, 1] for a degenerate guidedTimeFrac (<= 0)', () => {
    expect(revealLineFraction(0.5, 0)).toBe(0.5);
    expect(revealLineFraction(1.2, 0)).toBe(1);
  });
});

describe('planetDiscAlpha', () => {
  const gf = 0.5;

  it('is fully opaque through the guided phase', () => {
    expect(planetDiscAlpha(0, gf)).toBe(1);
    expect(planetDiscAlpha(gf, gf)).toBe(1);
  });

  it('fades to 0 within the completion phase and stays there', () => {
    expect(planetDiscAlpha(1, gf)).toBe(0);
    const justAfter = planetDiscAlpha(gf + 0.01, gf);
    expect(justAfter).toBeLessThan(1);
    expect(justAfter).toBeGreaterThan(0);
  });

  it('reaches exactly 0 at the fade-completion point and stays there', () => {
    const fadeEnd = gf + PLANET_FADE_FRACTION * (1 - gf);
    expect(planetDiscAlpha(fadeEnd, gf)).toBeCloseTo(0, 10);
    expect(planetDiscAlpha(fadeEnd + 0.05, gf)).toBeCloseTo(0, 10);
  });
});
