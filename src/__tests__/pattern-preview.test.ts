// src/__tests__/pattern-preview.test.ts
//
// The Preview (CONTEXT.md) is fast, looping, and disposable. Only the pure
// loop-timing math is unit-tested; the rAF canvas loop is exercised in the
// browser (E2E step).

import { describe, it, expect } from 'vitest';
import { PREVIEW_LOOP_MS, PREVIEW_HOLD_FRACTION, previewLineFraction } from '../pattern-preview';

describe('previewLineFraction', () => {
  it('starts empty and reaches the full figure before the hold window', () => {
    expect(previewLineFraction(0)).toBe(0);
    expect(previewLineFraction(1 - PREVIEW_HOLD_FRACTION)).toBeCloseTo(1, 10);
  });

  it('holds the completed figure for the tail of the loop', () => {
    expect(previewLineFraction(1 - PREVIEW_HOLD_FRACTION / 2)).toBe(1);
    expect(previewLineFraction(0.999)).toBe(1);
  });

  it('loops fast enough to browse (a few seconds, not a reveal)', () => {
    expect(PREVIEW_LOOP_MS).toBeLessThanOrEqual(4000);
  });
});
