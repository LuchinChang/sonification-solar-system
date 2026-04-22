// src/__tests__/node-editor-sweeper-nodes.test.ts
//
// Unit 7: sweeper-self property nodes.
// Verifies each of the four defTypes is registered with the expected
// side / ports / defaultParams, that codegen returns '', and that the
// fineness field on CanvasShape quantizes the playhead angle.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
// Side-effect import registers the four sweeper-self nodes at load time.
// Do NOT _resetRegistryForTests() in this file; the registrations only run
// on first module evaluation.
import '../node-editor/nodes/sweeper';
import { getNodeDef } from '../node-editor';
import { CanvasShape, resetNextId } from '../shapes';
import { MIN_SHAPE_SIZE, MAX_SHAPE_SIZE } from '../state';
import { setSweeperResolver, setSweeperGeometryRefresh } from '../node-editor/nodes/sweeper';
import { initNodeEditor, openEditor, closeEditor } from '../node-editor/panel';
import type { Node } from '../node-editor/types';

describe('sweeper-self node registrations', () => {
  const expected: Array<{
    type: string;
    side: 'sweeper';
    defaultParams: Record<string, unknown>;
    inputName: string;
    inputKind: string;
  }> = [
    { type: 'sweeper.cluster-count', side: 'sweeper', defaultParams: { k: 3 },                     inputName: 'k',        inputKind: 'number' },
    { type: 'sweeper.fineness',      side: 'sweeper', defaultParams: { steps: 120 },               inputName: 'steps',    inputKind: 'number' },
    { type: 'sweeper.generator',     side: 'sweeper', defaultParams: { waveform: 'sine' },         inputName: 'waveform', inputKind: 'any' },
    { type: 'sweeper.length',        side: 'sweeper', defaultParams: { radius: MAX_SHAPE_SIZE },   inputName: 'radius',   inputKind: 'number' },
  ];

  for (const e of expected) {
    it(`registers "${e.type}" on the sweeper side with expected defaults`, () => {
      const def = getNodeDef(e.type);
      expect(def, `missing NodeDefinition for ${e.type}`).toBeDefined();
      expect(def!.side).toBe(e.side);
      expect(def!.defaultParams).toEqual(e.defaultParams);

      // Input ports: exactly one, matching name + kind.
      expect(def!.inputs).toHaveLength(1);
      expect(def!.inputs![0].id).toBe(e.inputName);
      expect(def!.inputs![0].kind).toBe(e.inputKind);

      // These nodes are pure state mutators — codegen is empty.
      const ctx = {
        sweeperId: 1,
        nodeVar: (s: string) => s,
        incoming: () => [],
        paramsOf: <T>() => ({} as T),
      };
      expect(def!.codegen(ctx, e.defaultParams, [])).toBe('');
    });
  }

  it('sweeper.length defaultParams.radius sits within MIN..MAX_SHAPE_SIZE', () => {
    const def = getNodeDef('sweeper.length');
    const { radius } = def!.defaultParams as { radius: number };
    expect(radius).toBeGreaterThanOrEqual(MIN_SHAPE_SIZE);
    expect(radius).toBeLessThanOrEqual(MAX_SHAPE_SIZE);
  });
});

describe('CanvasShape.fineness quantizes the playhead angle', () => {
  beforeEach(() => resetNextId(0));

  it('has a default fineness of 120', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 100);
    expect(s.fineness).toBe(120);
  });

  it('snaps the sweep angle to fineness discrete positions around 2π', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 100);
    s.fineness = 12;                        // 30° per step
    s.playheadAngle = 0;
    s.prevPlayheadAngle = 0;

    // After any advance, the angle must be an exact multiple of (2π / 12).
    const step = (Math.PI * 2) / 12;

    // Run several sub-steps that would normally land on non-step phases.
    for (const dt of [50, 83, 110, 137, 200]) {
      s.stepPlayhead(dt, 60);
      const mod = s.playheadAngle % step;
      const err = Math.min(mod, step - mod);
      expect(err).toBeLessThan(1e-9);
    }
  });

  it('does not quantize when fineness is 0 (guard behavior)', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 100);
    s.fineness = 0;
    s.playheadAngle = 0;
    s.prevPlayheadAngle = 0;

    s.stepPlayhead(17, 60);
    // With no quantization the angle is the raw advance, not a round step.
    const expected = (17 / 1000) * Math.PI * 2;
    expect(s.playheadAngle).toBeCloseTo(expected, 9);
  });
});

describe('sweeper.length slider triggers geometry refresh', () => {
  beforeEach(() => {
    resetNextId(0);
    setSweeperGeometryRefresh(null);
    setSweeperResolver(null);
    closeEditor();
  });

  it('mutates sweeper.size AND invokes the geometry-refresh hook on input', () => {
    const sweeper = new CanvasShape(0, 0, 'sweeper', 100);
    const resolver = (id: number) => (id === sweeper.id ? sweeper : null);
    initNodeEditor({ resolveSweeper: resolver });
    setSweeperResolver(resolver);
    const refresh = vi.fn();
    setSweeperGeometryRefresh(refresh);
    openEditor(sweeper.id);

    const def = getNodeDef('sweeper.length')!;
    const node: Node = {
      id: 'n1', type: 'sweeper.length', side: 'sweeper',
      x: 0, y: 0, params: { radius: sweeper.size },
    };
    const el = def.ui!(node, () => {});
    const slider = el.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).not.toBeNull();

    slider.value = '123';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(sweeper.size).toBe(123);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(sweeper);
  });

  it('does not throw when no geometry-refresh hook is registered', () => {
    const sweeper = new CanvasShape(0, 0, 'sweeper', 100);
    const resolver = (id: number) => (id === sweeper.id ? sweeper : null);
    initNodeEditor({ resolveSweeper: resolver });
    setSweeperResolver(resolver);
    openEditor(sweeper.id);

    const def = getNodeDef('sweeper.length')!;
    const node: Node = {
      id: 'n1', type: 'sweeper.length', side: 'sweeper',
      x: 0, y: 0, params: { radius: sweeper.size },
    };
    const el = def.ui!(node, () => {});
    const slider = el.querySelector('input[type="range"]') as HTMLInputElement;

    slider.value = '77';
    expect(() => slider.dispatchEvent(new Event('input', { bubbles: true }))).not.toThrow();
    expect(sweeper.size).toBe(77);
  });
});
