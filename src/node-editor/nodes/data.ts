// src/node-editor/nodes/data.ts
//
// Unit 6 — data-side sensor nodes.
//
// These four NodeDefinitions live in the "data" column of the sweeper
// node-editor. They don't consume inputs; each one reads a value that
// CanvasShape.computeSweepClusters() publishes onto globalThis every
// animation frame (see src/shapes.ts `_publishSensorGlobals`) and emits
// a Strudel `signal(() => globalThis.__sw_<id>_<name>)` fragment so
// downstream sound-side nodes can route it into any audio param.
//
// Globals layout (per sweeper id, written each rAF frame):
//   __sw_<id>_tol         — scalar, SWEEP_CLUSTER_THRESHOLD (px)
//   __sw_<id>_count       — scalar, live cluster count on the ray
//   __sw_<id>_dist_<i>    — per-cluster distance in px (i ∈ [0, shape.k))
//   __sw_<id>_angvar_<i>  — per-cluster angle stdev in rad
//
// Per-cluster nodes carry `params.slot` (default 0) so the user can place
// several of them and point each one at a different cluster index.

import { registerNodeDef } from '../registry';
import type { CodegenCtx, Edge, NodeDefinition } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Render the canonical `signal(() => globalThis.X)` fragment. */
function signalFragment(globalName: string): string {
  return `signal(() => globalThis.${globalName})`;
}

/** Coerce an unknown param to a non-negative integer slot index. */
function readSlot(params: Record<string, unknown>): number {
  const raw = params['slot'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

// ── Scalar sensors ───────────────────────────────────────────────────────────

/** Emits the proximity-threshold constant driving computeSweepClusters. */
export const clusterToleranceDef: NodeDefinition = {
  type:  'data.cluster-tolerance',
  side:  'data',
  label: 'Cluster Tolerance',
  outputs: [{
    id: 'tolerance', label: 'tolerance', kind: 'number', continuous: true,
    min: 0, max: 40, unit: 'px',
    description: 'Proximity threshold used by the cluster detector (pixels). Larger values merge nearby intersections.',
  }],
  codegen: (ctx: CodegenCtx, _params, _inbound: Edge[]): string =>
    signalFragment(`__sw_${ctx.sweeperId}_tol`),
};

/** Emits the live number of clusters on the sweeper ray. */
export const clusterCountDef: NodeDefinition = {
  type:  'data.cluster-count',
  side:  'data',
  label: 'Cluster Count',
  outputs: [{
    id: 'count', label: 'count', kind: 'number', continuous: true,
    min: 0, max: 12, unit: 'clusters',
    description: 'Live number of intersection clusters detected along the sweeper ray (0 when the ray is clear).',
  }],
  codegen: (ctx: CodegenCtx, _params, _inbound: Edge[]): string =>
    signalFragment(`__sw_${ctx.sweeperId}_count`),
};

// ── Per-cluster sensors ──────────────────────────────────────────────────────

/** Per-cluster distance stream. Pick a cluster slot via params.slot. */
export const distanceToSunDef: NodeDefinition = {
  type:  'data.distance-to-sun',
  side:  'data',
  label: 'Distance to Sun',
  outputs: [{
    id: 'distance', label: 'distance', kind: 'number', continuous: true,
    min: 0, max: 500, unit: 'px',
    description: 'Distance from the selected cluster centroid to the Sun, in pixels. Useful as a spatial driver for pitch / filter cutoff.',
  }],
  defaultParams: { slot: 0 },
  codegen: (ctx: CodegenCtx, params, _inbound: Edge[]): string =>
    signalFragment(`__sw_${ctx.sweeperId}_dist_${readSlot(params)}`),
};

/** Per-cluster spread of link-line angles. */
export const angleVarianceDef: NodeDefinition = {
  type:  'data.angle-variance',
  side:  'data',
  label: 'Angle Variance',
  outputs: [{
    id: 'variance', label: 'variance', kind: 'number', continuous: true,
    min: 0, max: Math.PI, unit: 'rad',
    description: 'Standard deviation of link-line angles inside the selected cluster (radians). High values indicate chaotic local geometry.',
  }],
  defaultParams: { slot: 0 },
  codegen: (ctx: CodegenCtx, params, _inbound: Edge[]): string =>
    signalFragment(`__sw_${ctx.sweeperId}_angvar_${readSlot(params)}`),
};

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all four data-side defs with the shared registry.
 * Idempotent guarded via the registry's own duplicate-throw; callers are
 * expected to invoke this exactly once (either at app boot from main.ts or
 * after `_resetRegistryForTests()` in tests).
 */
export function registerDataNodes(): void {
  registerNodeDef(clusterToleranceDef);
  registerNodeDef(clusterCountDef);
  registerNodeDef(distanceToSunDef);
  registerNodeDef(angleVarianceDef);
}
