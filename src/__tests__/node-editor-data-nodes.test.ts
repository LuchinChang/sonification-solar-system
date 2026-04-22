// src/__tests__/node-editor-data-nodes.test.ts
//
// Unit 6 — data-side sensor node coverage.
//
// Verifies that:
//   1. All four NodeDefinitions register correctly on the 'data' side.
//   2. Each node's codegen() returns the canonical
//      `signal(() => globalThis.__sw_<id>_<name>)` fragment.
//   3. CanvasShape.computeSweepClusters() publishes live values onto
//      globalThis for the sweeper (tol / count / dist_i / angvar_i), with
//      empty slots zeroed up to shape.k.
//   4. SweepCluster exposes a finite angleVariance field.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  listNodeDefs,
  getNodeDef,
  registerDataNodes,
} from '../node-editor';
import type { CodegenCtx } from '../node-editor';
import { _resetRegistryForTests } from '../node-editor/registry';
import { CanvasShape } from '../shapes';
import { angleStdev } from '../geometry';
import type { Point } from '../geometry';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal CodegenCtx stub — data nodes only read `sweeperId`. */
function makeCtx(sweeperId: number): CodegenCtx {
  return {
    sweeperId,
    nodeVar:   (nodeId: string) => `sw_${sweeperId}_${nodeId}`,
    incoming:  () => [],
    paramsOf:  <T = Record<string, unknown>>() => ({} as T),
  };
}

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

  it('each def declares a single number output and no inputs', () => {
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
    }
  });
});

// ── Codegen fragments ────────────────────────────────────────────────────────

describe('data-node codegen', () => {
  it('cluster-tolerance → __sw_<id>_tol', () => {
    const def = getNodeDef('data.cluster-tolerance')!;
    expect(def.codegen(makeCtx(7), {}, [])).toBe(
      'signal(() => globalThis.__sw_7_tol)',
    );
  });

  it('cluster-count → __sw_<id>_count', () => {
    const def = getNodeDef('data.cluster-count')!;
    expect(def.codegen(makeCtx(3), {}, [])).toBe(
      'signal(() => globalThis.__sw_3_count)',
    );
  });

  it('distance-to-sun picks slot from params (default 0)', () => {
    const def = getNodeDef('data.distance-to-sun')!;
    expect(def.codegen(makeCtx(2), {}, [])).toBe(
      'signal(() => globalThis.__sw_2_dist_0)',
    );
    expect(def.codegen(makeCtx(2), { slot: 3 }, [])).toBe(
      'signal(() => globalThis.__sw_2_dist_3)',
    );
  });

  it('angle-variance picks slot from params (default 0)', () => {
    const def = getNodeDef('data.angle-variance')!;
    expect(def.codegen(makeCtx(5), {}, [])).toBe(
      'signal(() => globalThis.__sw_5_angvar_0)',
    );
    expect(def.codegen(makeCtx(5), { slot: 2 }, [])).toBe(
      'signal(() => globalThis.__sw_5_angvar_2)',
    );
  });

  it('slot param is coerced safely for bad inputs', () => {
    const def = getNodeDef('data.distance-to-sun')!;
    expect(def.codegen(makeCtx(1), { slot: -4 },       [])).toContain('_dist_0');
    expect(def.codegen(makeCtx(1), { slot: 2.7 },      [])).toContain('_dist_2');
    expect(def.codegen(makeCtx(1), { slot: 'oops' },   [])).toContain('_dist_0');
  });
});

// ── Live global publication (shapes.ts wiring) ───────────────────────────────

describe('CanvasShape sensor globals', () => {
  it('publishes tol + count + per-slot dist/angvar every frame', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = 3;
    s.computeSweepClusters(makeCrossLines(0, 0, 100), 315);

    const g = globalThis as unknown as Record<string, number>;
    expect(g[`__sw_${s.id}_tol`]).toBe(2);
    expect(g[`__sw_${s.id}_count`]).toBe(s.sweepClusters.length);

    for (let i = 0; i < s.k; i++) {
      expect(typeof g[`__sw_${s.id}_dist_${i}`]).toBe('number');
      expect(typeof g[`__sw_${s.id}_angvar_${i}`]).toBe('number');
    }
  });

  it('zeroes slots with no live cluster', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = 8; // way more slots than the 4 cross-lines can fill
    s.computeSweepClusters(makeCrossLines(0, 0, 100), 315);

    const g = globalThis as unknown as Record<string, number>;
    const filled = s.sweepClusters.length;
    for (let i = filled; i < s.k; i++) {
      expect(g[`__sw_${s.id}_dist_${i}`]).toBe(0);
      expect(g[`__sw_${s.id}_angvar_${i}`]).toBe(0);
    }
  });

  it('each cluster exposes a finite, non-negative angleVariance', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = 4;
    s.computeSweepClusters(makeCrossLines(0, 0, 100), 315);

    for (const c of s.sweepClusters) {
      expect(Number.isFinite(c.angleVariance)).toBe(true);
      expect(c.angleVariance).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── geometry.angleStdev unit tests ───────────────────────────────────────────

describe('angleStdev', () => {
  it('returns 0 for empty or single-element input', () => {
    expect(angleStdev([])).toBe(0);
    expect(angleStdev([0.42])).toBe(0);
  });

  it('returns 0 for a set of parallel (direction-flipped) lines', () => {
    // A line with direction θ and one with θ+π are the same line.
    expect(angleStdev([0.3, 0.3 + Math.PI])).toBeCloseTo(0, 6);
  });

  it('returns a positive value for lines at different orientations', () => {
    expect(angleStdev([0, Math.PI / 2])).toBeGreaterThan(0);
  });
});
