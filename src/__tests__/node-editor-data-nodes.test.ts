// src/__tests__/node-editor-data-nodes.test.ts
//
// Data-side sensor nodes — new 0..1 `perTickValue` contract.
//
// Verifies:
//   1. All four NodeDefinitions register correctly on the 'data' side.
//   2. `codegen()` returns the empty string (data chips never emit chain
//      fragments; their values are baked into sound chips via SweepStack).
//   3. `perTickValue(shape, arm, tick, slot, maxR)` returns a value in [0, 1]
//      across synthetic shape states. Missing slot → 0. maxR <= 0 → 0.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  listNodeDefs,
  getNodeDef,
  registerDataNodes,
} from '../node-editor';
import { _resetRegistryForTests } from '../node-editor/registry';
import { CanvasShape } from '../shapes';
import { angleStdev } from '../geometry';
import type { Point } from '../geometry';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeCrossLines(cx: number, cy: number, radius: number): { p1: Point; p2: Point }[] {
  return [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map(angle => ({
    p1: {
      x: cx + (radius + 50) * Math.cos(angle),
      y: cy + (radius + 50) * Math.sin(angle),
    },
    p2: {
      x: cx - (radius + 50) * Math.cos(angle),
      y: cy - (radius + 50) * Math.sin(angle),
    },
  }));
}

beforeEach(() => {
  _resetRegistryForTests();
  registerDataNodes();
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('data-node registration', () => {
  it('registers all four data-side defs', () => {
    const data = listNodeDefs('data');
    const types = data.map(d => d.type).sort();
    expect(types).toEqual([
      'data.angle-variance',
      'data.cluster-count',
      'data.cluster-tolerance',
      'data.distance-to-sun',
    ]);
  });

  it('each def declares a single number output, no inputs, and perTickValue', () => {
    for (const type of [
      'data.cluster-tolerance',
      'data.cluster-count',
      'data.distance-to-sun',
      'data.angle-variance',
    ]) {
      const def = getNodeDef(type)!;
      expect(def.side).toBe('data');
      expect(def.inputs ?? []).toEqual([]);
      expect(def.outputs).toHaveLength(1);
      expect(def.outputs![0].kind).toBe('number');
      expect(typeof def.perTickValue).toBe('function');
      expect(def.codegen(
        // dummy ctx — codegen returns '' so fields go unused.
        {
          sweeperId: 0,
          nodeVar: () => '',
          incoming: () => [],
          paramsOf: <T>() => ({} as T),
          resolveInboundStack: () => null,
        },
        {},
        [],
      )).toBe('');
    }
  });
});

// ── perTickValue: 0..1 contract ──────────────────────────────────────────────

describe('data-node perTickValue — 0..1 contract', () => {
  function buildSweeper(k: number): CanvasShape {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = k;
    s.ticks = 60;
    s.rebuildSweepTicks(makeCrossLines(0, 0, 100), 315);
    return s;
  }

  it('cluster-tolerance is a constant 0..1 value (threshold 2 / 40 ≈ 0.05)', () => {
    const def = getNodeDef('data.cluster-tolerance')!;
    const v = def.perTickValue!(buildSweeper(4), 0, 0, 0, 315);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeCloseTo(2 / 40, 6);
  });

  it('cluster-count returns per-slot density (link-lines / 20), 0 for empty slots', () => {
    // Round 2 semantic: cluster-count no longer returns group.length/k
    // (which pinned to 1 when the sky was busy). Instead it reports the
    // slot's own density (link-lines per cluster), normalized against a
    // 20-hit cap — the same curve the legacy `_toSweeperCode` used.
    const def = getNodeDef('data.cluster-count')!;
    const s   = buildSweeper(4);
    // Slot far past shape.k is guaranteed empty → 0.
    expect(def.perTickValue!(s, 0, 0, 99, 315)).toBe(0);
    // Every call must stay in [0, 1] — invariant relied on by sound-chip
    // curve/range transforms.
    for (let arm = 0; arm < s.sweepCount; arm++) {
      for (let t = 0; t < s.ticks; t++) {
        for (let slot = 0; slot < s.k; slot++) {
          const v = def.perTickValue!(s, arm, t, slot, 315);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('distance-to-sun normalizes by maxR and clamps to [0, 1]', () => {
    const def = getNodeDef('data.distance-to-sun')!;
    const s   = buildSweeper(4);
    const maxR = s.sweepMaxR;
    expect(maxR).toBeGreaterThan(0);
    for (let arm = 0; arm < s.sweepCount; arm++) {
      for (let t = 0; t < s.ticks; t++) {
        const v = def.perTickValue!(s, arm, t, 0, maxR);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('distance-to-sun returns 0 when the slot is out of range', () => {
    const def = getNodeDef('data.distance-to-sun')!;
    const s   = buildSweeper(1);
    const v   = def.perTickValue!(s, 0, 0, /* out-of-range slot */ 99, s.sweepMaxR);
    expect(v).toBe(0);
  });

  it('distance-to-sun returns 0 when maxR <= 0 (defensive)', () => {
    const def = getNodeDef('data.distance-to-sun')!;
    const s   = buildSweeper(4);
    expect(def.perTickValue!(s, 0, 0, 0, 0)).toBe(0);
    expect(def.perTickValue!(s, 0, 0, 0, -5)).toBe(0);
  });

  it('angle-variance normalizes by π and stays within [0, 1]', () => {
    const def = getNodeDef('data.angle-variance')!;
    const s   = buildSweeper(4);
    for (let arm = 0; arm < s.sweepCount; arm++) {
      for (let t = 0; t < s.ticks; t++) {
        const v = def.perTickValue!(s, arm, t, 0, s.sweepMaxR);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('angle-variance returns 0 for missing slot', () => {
    const def = getNodeDef('data.angle-variance')!;
    const s   = buildSweeper(1);
    const v   = def.perTickValue!(s, 0, 0, 99, s.sweepMaxR);
    expect(v).toBe(0);
  });
});

// ── geometry.angleStdev unit tests (unchanged) ──────────────────────────────

describe('angleStdev', () => {
  it('returns 0 for empty or single-element input', () => {
    expect(angleStdev([])).toBe(0);
    expect(angleStdev([0.42])).toBe(0);
  });

  it('returns 0 for a set of parallel (direction-flipped) lines', () => {
    expect(angleStdev([0.3, 0.3 + Math.PI])).toBeCloseTo(0, 6);
  });

  it('returns a positive value for lines at different orientations', () => {
    expect(angleStdev([0, Math.PI / 2])).toBeGreaterThan(0);
  });
});
