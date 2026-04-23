// src/node-editor/nodes/data.ts
//
// Data-side sensor nodes. Each definition exposes a `perTickValue()` that
// returns a normalized `0..1` value at a given `(arm, tick, slot)` coordinate.
// The codegen driver (codegen.ts) calls this to build a shared `SweepStack`,
// which downstream sound chips then transform into their own native range.
//
// Contract: outputs are ALWAYS in [0, 1]. Missing data → 0. Sound chips
// rely on this invariant when applying their own min/max curve.

import { clamp } from '../../engine';
import { SWEEP_CLUSTER_THRESHOLD } from '../../shapes';
import { registerNodeDef } from '../registry';
import type { CanvasShape } from '../../shapes';
import type { NodeDefinition } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function readSlot(params: Record<string, unknown>): number {
  const raw = params['slot'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

function tickCluster(shape: CanvasShape, arm: number, tick: number, slot: number) {
  const armTicks = shape.sweepTicks[arm];
  if (!armTicks) return undefined;
  const group = armTicks[tick];
  if (!group) return undefined;
  return group[slot];
}

// ── Scalar sensors ───────────────────────────────────────────────────────────

/** Proximity-threshold constant driving computeSweepClusters. */
export const clusterToleranceDef: NodeDefinition = {
  type:  'data.cluster-tolerance',
  side:  'data',
  label: 'Cluster Tolerance',
  outputs: [{
    id: 'tolerance', label: 'tolerance', kind: 'number', continuous: true,
    min: 0, max: 1, unit: '0..1',
    description: 'Proximity threshold used by the cluster detector, normalized 0..1 against a 40 px ceiling.',
  }],
  codegen: () => '',
  perTickValue: () => clamp(SWEEP_CLUSTER_THRESHOLD / 40, 0, 1),
};

/**
 * Per-tick, per-slot cluster *density*.
 *
 * The codegen driver fans out voices over `(arm × slot)`, so this chip
 * delivers each voice its own slot's link-line count (0 when the slot is
 * empty), normalized against `CLUSTER_DENSITY_CAP`. Round 1 normalized by
 * `shape.k` — which pinned to 1 whenever the top-k was full (nearly always
 * in busy scenes), producing the flat-gain bug. Density gives you real
 * per-tick variation: a cluster of 2 crossings reads quieter than a cluster
 * of 10, and empty slots silence their voice entirely.
 *
 * The cap of 20 mirrors the legacy gain curve in
 * [shapes.ts:782](../../shapes.ts:782):
 *   `gain: 0.6 + Math.min(group.length / 20, 1.0) * 0.3`
 * so the audible dynamic range here matches the pre-graph sweeper.
 */
export const CLUSTER_DENSITY_CAP = 20;

export const clusterCountDef: NodeDefinition = {
  type:  'data.cluster-count',
  side:  'data',
  label: 'Cluster Count',
  outputs: [{
    id: 'count', label: 'count', kind: 'number', continuous: true,
    min: 0, max: 1, unit: '0..1',
    description: 'Per-slot cluster density (link-lines per cluster) at this tick, normalized against a 20-hit cap. 0 when the voice\'s slot is empty.',
  }],
  codegen: () => '',
  perTickValue(shape, arm, tick, slot) {
    const armTicks = shape.sweepTicks[arm];
    if (!armTicks) return 0;
    const group = armTicks[tick];
    if (!group) return 0;
    const c = group[slot];
    if (!c) return 0;
    return clamp(c.density / CLUSTER_DENSITY_CAP, 0, 1);
  },
};

// ── Per-cluster sensors ──────────────────────────────────────────────────────

/** Per-cluster distance, normalized by the effective maxR (arm length). */
export const distanceToSunDef: NodeDefinition = {
  type:  'data.distance-to-sun',
  side:  'data',
  label: 'Distance to Sun',
  outputs: [{
    id: 'distance', label: 'distance', kind: 'number', continuous: true,
    min: 0, max: 1, unit: '0..1',
    description: 'Distance from cluster centroid to Sun, normalized 0..1 against the sweeper arm length. Missing cluster → 0.',
  }],
  codegen: () => '',
  perTickValue(shape, arm, tick, slot, maxR) {
    const c = tickCluster(shape, arm, tick, slot);
    if (!c || maxR <= 0) return 0;
    return clamp(c.distance / maxR, 0, 1);
  },
};

/** Per-cluster angle stdev, normalized by π. */
export const angleVarianceDef: NodeDefinition = {
  type:  'data.angle-variance',
  side:  'data',
  label: 'Angle Variance',
  outputs: [{
    id: 'variance', label: 'variance', kind: 'number', continuous: true,
    min: 0, max: 1, unit: '0..1',
    description: 'Standard deviation of link-line angles inside the selected cluster, normalized 0..1 against π.',
  }],
  codegen: () => '',
  perTickValue(shape, arm, tick, slot) {
    const c = tickCluster(shape, arm, tick, slot);
    if (!c) return 0;
    return clamp(c.angleVariance / Math.PI, 0, 1);
  },
};

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Pass-through wrapper — `readSlot` retained as an export in case the
 * registry growing per-slot UI chrome ever needs it again. Cheap to keep.
 */
export { readSlot };

export function registerDataNodes(): void {
  registerNodeDef(clusterToleranceDef);
  registerNodeDef(clusterCountDef);
  registerNodeDef(distanceToSunDef);
  registerNodeDef(angleVarianceDef);
}
