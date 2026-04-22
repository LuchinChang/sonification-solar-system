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

/** Per-tick cluster count, normalized by `shape.k`. */
export const clusterCountDef: NodeDefinition = {
  type:  'data.cluster-count',
  side:  'data',
  label: 'Cluster Count',
  outputs: [{
    id: 'count', label: 'count', kind: 'number', continuous: true,
    min: 0, max: 1, unit: '0..1',
    description: 'Cluster count at this tick, divided by the sweeper\'s k parameter. 0 when the ray is clear.',
  }],
  codegen: () => '',
  perTickValue(shape, arm, tick) {
    const armTicks = shape.sweepTicks[arm];
    if (!armTicks) return 0;
    const group = armTicks[tick];
    if (!group) return 0;
    const k = Math.max(1, shape.k);
    return clamp(group.length / k, 0, 1);
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
  defaultParams: { slot: 0 },
  codegen: () => '',
  perTickValue(shape, arm, tick, _slotArg, maxR) {
    const slot = _slotArg;
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
  defaultParams: { slot: 0 },
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
