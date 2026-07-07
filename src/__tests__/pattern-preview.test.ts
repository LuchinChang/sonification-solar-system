// src/__tests__/pattern-preview.test.ts
//
// The Preview (CONTEXT.md) is fast, disposable, and draw-ONCE (2026-07-06):
// the figure draws over PREVIEW_DRAW_MS then holds completed — no loop. Only
// the pure timing math is unit-tested; the rAF canvas loop and nodal glow
// overlay are exercised in the browser (E2E step).

import { describe, it, expect } from 'vitest';
import { PREVIEW_DRAW_MS, previewLineFraction } from '../pattern-preview';

describe('previewLineFraction (draw-once)', () => {
  it('starts at 0 and completes at PREVIEW_DRAW_MS', () => {
    expect(previewLineFraction(0)).toBe(0);
    expect(previewLineFraction(PREVIEW_DRAW_MS)).toBe(1);
  });

  it('holds at 1 forever after (no loop)', () => {
    expect(previewLineFraction(PREVIEW_DRAW_MS * 2)).toBe(1);
    expect(previewLineFraction(PREVIEW_DRAW_MS * 100)).toBe(1);
  });

  it('is monotonic during the draw', () => {
    expect(previewLineFraction(PREVIEW_DRAW_MS * 0.25))
      .toBeLessThan(previewLineFraction(PREVIEW_DRAW_MS * 0.5));
  });

  it('clamps negative elapsed to 0', () => {
    expect(previewLineFraction(-50)).toBe(0);
  });

  it('draws fast enough to browse (a couple of seconds, not a reveal)', () => {
    expect(PREVIEW_DRAW_MS).toBeLessThanOrEqual(3000);
  });
});
