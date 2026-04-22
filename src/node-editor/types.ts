// src/node-editor/types.ts
//
// Core type definitions for the sweeper node-editor.
//
// Pre-baked codegen (round 1 bug-fix): data-side chips declare a
// `perTickValue(shape, arm, tick, slot, maxR) -> 0..1` that the codegen
// driver calls to build a shared `SweepStack`. Sound-side chips receive the
// resolved stack via `CodegenCtx.resolveInboundStack`, apply their own
// curve/range transform, and emit a static Strudel pattern string (e.g.
// `.freq("100 141 200 …")`). No live signal(() => globalThis.__sw_…) reads.

import type { CanvasShape } from '../shapes';

// ── Side: which column a node lives in inside the editor ─────────────────────

export type NodeSide = 'data' | 'sound' | 'sweeper' | 'playback';

// ── Port kind: drives visual styling + compatibility checks ──────────────────
//
// Phase 2 will extend this list; for Unit 4 we enumerate the likely kinds
// so later units don't have to widen the type everywhere.

export type PortKind =
  | 'number'
  | 'signal'     // continuous time-varying value (Hz, gain…)
  | 'trigger'   // discrete event stream (bang)
  | 'pattern'   // Strudel pattern
  | 'string'    // enum / tag values (e.g. playback-mode selectors)
  | 'any';

export interface PortSpec {
  id:    string;
  label: string;
  kind:  PortKind;
  /** Optional: hints that codegen can treat this as a hot signal vs snapshot. */
  continuous?: boolean;

  // ── Informational metadata ───────────────────────────────────────────────
  //
  // Purely documentary for tooltips / indicators. These fields do NOT affect
  // codegen. In the pre-baked pipeline, range-mapping is owned by each
  // sound chip's `codegen` via the `bakePattern(stack, min, max, curve)`
  // helper — this metadata only shapes the hover/tooltip UI.
  /** Lower end of the port's expected numeric range. */
  min?: number;
  /** Upper end of the port's expected numeric range. */
  max?: number;
  /** Short unit label (e.g. `"Hz"`, `"px"`, `"0..1"`). */
  unit?: string;
  /** Human-readable description shown in hover tooltips. */
  description?: string;
}

// ── Port: concrete instance on a placed node ─────────────────────────────────

export type PortDirection = 'in' | 'out';

export interface Port {
  nodeId: string;
  portId: string;
  dir:    PortDirection;
}

// ── Edge: directed cable between two ports ───────────────────────────────────

export interface Edge {
  id:   string;
  from: Port;  // must be dir: 'out'
  to:   Port;  // must be dir: 'in'
}

// ── Node: placed instance with per-node params ──────────────────────────────

export interface Node {
  id:     string;
  type:   string;                       // matches a registered NodeDefinition.type
  side:   NodeSide;
  x:      number;                       // layout x inside the panel (column-relative)
  y:      number;                       // layout y
  params: Record<string, unknown>;     // user-editable knobs, copies of defaultParams
}

// ── Graph: serialisable state of one sweeper's node configuration ────────────

export interface NodeGraph {
  sweeperId: number;                    // matches CanvasShape.id
  nodes:    Node[];
  edges:    Edge[];
}

// ── Sweep stack: baked 0..1 values, one per (arm, tick) slot ─────────────────
//
// Length = `shape.sweepCount * shape.ticks`. Index `arm * shape.ticks + tick`.
// Produced by the codegen driver by calling a data-chip's `perTickValue` over
// every (arm, tick) coordinate. Shared across sound chips: if two sound chips
// are wired to the same data chip, they read the same stack (computed once).

export type SweepStack = number[];

// ── Codegen context, handed to NodeDefinition.codegen() ─────────────────────

export interface CodegenCtx {
  sweeperId: number;
  /** Stable Strudel-safe identifier for this node (e.g. `sw_3_data_dist_1`). */
  nodeVar(nodeId: string): string;
  /** Lookup helper: inbound edges into a given input port. */
  incoming(nodeId: string, portId: string): Edge[];
  /** Read a node's params (typed by the caller). */
  paramsOf<T = Record<string, unknown>>(nodeId: string): T;
  /**
   * Resolve the first inbound edge on (nodeId, portId) to its baked 0..1
   * stack. Returns null if the port is unwired or the source chip has no
   * `perTickValue` implementation. Sound chips call this to get their
   * input values without caring where they came from.
   */
  resolveInboundStack(nodeId: string, portId: string): SweepStack | null;
}

// ── NodeDefinition: registry entry ───────────────────────────────────────────

export interface NodeDefinition {
  type:  string;                        // e.g. 'data.distance-to-sun'
  side:  NodeSide;
  label: string;
  inputs?:  PortSpec[];
  outputs?: PortSpec[];
  defaultParams?: Record<string, unknown>;

  /**
   * Emit the Strudel source fragment for this node. Unit 14 composes all the
   * returned fragments into the final sweeper pattern. Codegen is DEFERRED —
   * it only runs when the editor panel closes (see panel.ts).
   */
  codegen: (
    ctx: CodegenCtx,
    params: Record<string, unknown>,
    inbound: Edge[],
  ) => string;

  /**
   * Optional: render per-node UI chrome inside the placed node card
   * (sliders, enum pickers…). Phase 2 will populate this.
   */
  ui?: (node: Node, onChange: (patch: Partial<Node>) => void) => HTMLElement;

  /**
   * Data-side only: compute a 0..1 value at a given (arm, tick, slot)
   * coordinate. The codegen driver calls this over every (arm, tick) to
   * produce a `SweepStack`. Missing data (e.g. slot out of range) should
   * return 0. Values MUST be in `[0, 1]` — sound chips rely on that
   * invariant when applying their own min/max transform.
   *
   * `slot` is the intra-tick cluster index (`0..shape.k-1`); chips that
   * don't have per-cluster state (e.g. cluster-count, tolerance) ignore it.
   */
  perTickValue?: (
    shape: CanvasShape,
    arm:   number,
    tick:  number,
    slot:  number,
    maxR:  number,
  ) => number;
}
