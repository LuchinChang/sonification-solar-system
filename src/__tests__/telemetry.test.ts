// src/__tests__/telemetry.test.ts
//
// Tests for Strudel code generation and surgical textarea patching.

import { describe, it, expect } from 'vitest';
import { CanvasShape } from '../shapes';
import {
  generateFullCode,
  patchRhythm,
  patchShapeBlock,
  patchHeader,
  patchAllRhythms,
  setEvalStatus,
  flashTelemBlock,
} from '../telemetry';

// Helper: create a mock textarea
function mockTextarea(value = ''): HTMLTextAreaElement {
  const el = { value, className: '', classList: { remove: () => {}, add: () => {} }, offsetWidth: 0 } as unknown as HTMLTextAreaElement;
  return el;
}

describe('generateFullCode', () => {
  it('generates header-only code when no shapes exist', () => {
    const code = generateFullCode([], 'TestPattern', 500, 60);
    expect(code).toContain('// Solar System Sonification');
    expect(code).toContain('Pattern: TestPattern');
    expect(code).toContain('Shapes: 0');
    expect(code).toContain('Samples: 500');
    expect(code).toContain('CPM: 60');
    expect(code).toContain('Spawn shapes from the Sonic Foundry dock.');
  });

  it('generates code with one shape', () => {
    const shape = new CanvasShape(400, 300, 'circle', 80);
    shape.rebuildIntersectionCache([]);
    const code = generateFullCode([shape], 'Venus', 500, 60);
    expect(code).toContain('Shapes: 1');
    expect(code).toContain('@shape-start-');
    expect(code).toContain('@rhythm-');
    expect(code).toContain('@shape-end-');
  });

  it('generates code with multiple shapes', () => {
    const s1 = new CanvasShape(400, 300, 'circle', 80);
    const s2 = new CanvasShape(400, 300, 'triangle', 60);
    s1.rebuildIntersectionCache([]);
    s2.rebuildIntersectionCache([]);
    const code = generateFullCode([s1, s2], 'Mars', 1000, 30);
    expect(code).toContain('Shapes: 2');
    expect(code).toContain(`@shape-start-${s1.id}`);
    expect(code).toContain(`@shape-start-${s2.id}`);
  });

  it('includes correct pattern name, sample rate, and CPM in header', () => {
    const code = generateFullCode([], 'Lunar Hexagon', 200, 42);
    expect(code).toContain('Pattern: Lunar Hexagon');
    expect(code).toContain('Samples: 200');
    expect(code).toContain('CPM: 42');
  });
});

describe('patchRhythm', () => {
  it('replaces the rhythm string for a specific shape', () => {
    const shape = new CanvasShape(400, 300, 'circle', 80);
    shape.rebuildIntersectionCache([]);
    const original = generateFullCode([shape], 'Test', 500, 60);
    const textarea = mockTextarea(original);

    // Change shape size to get a different rhythm string
    shape.size = 120;
    shape.rebuildIntersectionCache([]);
    patchRhythm(textarea, shape);

    // Verify rhythm marker still present
    expect(textarea.value).toContain(`// @rhythm-${shape.id}`);
  });

  it('is idempotent — applying twice yields same result', () => {
    const shape = new CanvasShape(400, 300, 'circle', 80);
    shape.rebuildIntersectionCache([]);
    const original = generateFullCode([shape], 'Test', 500, 60);
    const textarea = mockTextarea(original);

    patchRhythm(textarea, shape);
    const afterFirst = textarea.value;

    patchRhythm(textarea, shape);
    expect(textarea.value).toBe(afterFirst);
  });
});

describe('patchShapeBlock', () => {
  it('replaces entire block when markers are present', () => {
    const shape = new CanvasShape(400, 300, 'circle', 80);
    shape.rebuildIntersectionCache([]);
    const original = generateFullCode([shape], 'Test', 500, 60);
    const textarea = mockTextarea(original);

    shape.instrument = 'sine';
    patchShapeBlock(textarea, shape, [shape], 'Test', 500, 60);

    expect(textarea.value).toContain(`@shape-start-${shape.id}`);
    expect(textarea.value).toContain('sine');
  });

  it('falls back to full regeneration when markers are missing', () => {
    const shape = new CanvasShape(400, 300, 'circle', 80);
    shape.rebuildIntersectionCache([]);
    const textarea = mockTextarea('// no markers here');

    patchShapeBlock(textarea, shape, [shape], 'Test', 500, 60);

    expect(textarea.value).toContain(`@shape-start-${shape.id}`);
  });
});

describe('patchHeader', () => {
  it('updates the header line with new values', () => {
    const shape = new CanvasShape(400, 300, 'circle', 80);
    shape.rebuildIntersectionCache([]);
    const original = generateFullCode([shape], 'Old', 500, 60);
    const textarea = mockTextarea(original);

    patchHeader(textarea, 'New Pattern', 3, 1000, 90);

    expect(textarea.value).toContain('Pattern: New Pattern');
    expect(textarea.value).toContain('Shapes: 3');
    expect(textarea.value).toContain('Samples: 1000');
    expect(textarea.value).toContain('CPM: 90');
  });
});

describe('patchAllRhythms', () => {
  it('patches all shapes without disturbing non-rhythm content', () => {
    const s1 = new CanvasShape(400, 300, 'circle', 80);
    const s2 = new CanvasShape(400, 300, 'triangle', 60);
    s1.rebuildIntersectionCache([]);
    s2.rebuildIntersectionCache([]);
    const original = generateFullCode([s1, s2], 'Test', 500, 60);
    const textarea = mockTextarea(original);

    patchAllRhythms(textarea, [s1, s2], 'Test', 500, 60);

    // Both rhythm markers still present
    expect(textarea.value).toContain(`// @rhythm-${s1.id}`);
    expect(textarea.value).toContain(`// @rhythm-${s2.id}`);
    // Both shape blocks still present
    expect(textarea.value).toContain(`@shape-start-${s1.id}`);
    expect(textarea.value).toContain(`@shape-start-${s2.id}`);
  });
});

describe('setEvalStatus', () => {
  it('sets ok class and synced text', () => {
    const el = { className: '', textContent: '' } as HTMLElement;
    setEvalStatus(el, 'ok');
    expect(el.className).toBe('eval-status ok');
    expect(el.textContent).toContain('synced');
  });

  it('sets error class and error text', () => {
    const el = { className: '', textContent: '' } as HTMLElement;
    setEvalStatus(el, 'error');
    expect(el.className).toBe('eval-status error');
    expect(el.textContent).toContain('error');
  });

  it('sets idle class with empty text', () => {
    const el = { className: '', textContent: '' } as HTMLElement;
    setEvalStatus(el, 'idle');
    expect(el.className).toBe('eval-status idle');
    expect(el.textContent).toBe('');
  });
});

describe('flashTelemBlock', () => {
  it('respects cooldown period', () => {
    const el = {
      classList: {
        remove: () => {},
        add: () => {},
      },
      offsetWidth: 0,
    } as unknown as HTMLElement;
    const cooldowns = new Map<number, number>();

    // First flash should work
    flashTelemBlock(el, cooldowns, 1, 1000);
    expect(cooldowns.get(1)).toBe(1000);

    // Second flash within cooldown should be ignored
    flashTelemBlock(el, cooldowns, 1, 1050);
    expect(cooldowns.get(1)).toBe(1000); // unchanged
  });

  it('fires again after cooldown expires', () => {
    const el = {
      classList: {
        remove: () => {},
        add: () => {},
      },
      offsetWidth: 0,
    } as unknown as HTMLElement;
    const cooldowns = new Map<number, number>();

    flashTelemBlock(el, cooldowns, 1, 1000);
    flashTelemBlock(el, cooldowns, 1, 1200); // 200ms > 80ms cooldown
    expect(cooldowns.get(1)).toBe(1200);
  });
});
