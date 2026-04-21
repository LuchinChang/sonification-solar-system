// src/node-editor/types.ts
//
// Core type definitions for the sweeper node-editor.
//
// Phase 2+ units will register concrete NodeDefinitions via `registerNodeDef`
// (see registry.ts). The graph itself is plain data — no behaviour — so it
// serialises cleanly and is easy to diff. Codegen (Unit 14) walks the graph
// using the inbound-edge list + each node's `codegen()` fn.

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
  | 'any';

export interface PortSpec {
  id:    string;
  label: string;
  kind:  PortKind;
  /** Optional: hints that codegen can treat this as a hot signal vs snapshot. */
  continuous?: boolean;
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

// ── Codegen context, handed to NodeDefinition.codegen() by Unit 14 ──────────

export interface CodegenCtx {
  sweeperId: number;
  /** Stable Strudel-safe identifier for this node (e.g. `sw_3_data_dist_1`). */
  nodeVar(nodeId: string): string;
  /** Lookup helper: inbound edges into a given input port. */
  incoming(nodeId: string, portId: string): Edge[];
  /** Read a node's params (typed by the caller). */
  paramsOf<T = Record<string, unknown>>(nodeId: string): T;
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
}
