// src/node-editor/graph.ts
//
// Pure-data graph operations. No DOM, no audio, no side-effects.
//
// Validation rules enforced here:
//   1. Edge endpoints must reference existing nodes + ports.
//   2. Edge direction must be out → in.
//   3. Port kinds must be compatible (or one side must be `any`).
//   4. Adding an edge that would create a cycle throws.
//
// Removing a node cascades to its incident edges so callers don't have
// to clean up by hand.

import type { NodeGraphSnapshot } from '../config-snapshot';
import { getNodeDef } from './registry';
import type { Edge, Node, NodeGraph, NodeSide, PortKind } from './types';

// ── Construction ─────────────────────────────────────────────────────────────

export function createGraph(sweeperId: number): NodeGraph {
  return { sweeperId, nodes: [], edges: [] };
}

// ── Id minting (module-scoped — survives across graphs, no collisions) ───────

let _nodeSeq = 0;
let _edgeSeq = 0;
function mintNodeId(): string { return `n${++_nodeSeq}`; }
function mintEdgeId(): string { return `e${++_edgeSeq}`; }

/** Test-only reset. */
export function _resetIdsForTests(): void { _nodeSeq = 0; _edgeSeq = 0; }

/**
 * Advance the global id counters so the next minted id is strictly greater
 * than any id currently in `snapshot`. Keeps future addNode / addEdge calls
 * from colliding with ids that were restored from disk.
 *
 * Ids follow the `n123` / `e123` pattern; non-matching ids are ignored when
 * computing the max (defensive for externally-authored snapshots).
 */
function advanceIdCountersPast(snapshot: NodeGraphSnapshot): void {
  let maxN = _nodeSeq;
  let maxE = _edgeSeq;
  for (const n of snapshot.nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > maxN) maxN = v;
    }
  }
  for (const e of snapshot.edges) {
    const m = /^e(\d+)$/.exec(e.id);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v > maxE) maxE = v;
    }
  }
  _nodeSeq = maxN;
  _edgeSeq = maxE;
}

// ── Node ops ─────────────────────────────────────────────────────────────────

/** Add a node. Throws if its `type` isn't registered. */
export function addNode(
  g: NodeGraph,
  partial: Omit<Node, 'id' | 'params'> & { params?: Record<string, unknown> },
): Node {
  const def = getNodeDef(partial.type);
  if (!def) throw new Error(`[graph] unknown node type: "${partial.type}"`);
  const node: Node = {
    id:     mintNodeId(),
    type:   partial.type,
    side:   partial.side,
    x:      partial.x,
    y:      partial.y,
    params: { ...(def.defaultParams ?? {}), ...(partial.params ?? {}) },
  };
  g.nodes.push(node);
  return node;
}

/** Remove a node and every edge incident to it. Returns true if something was removed. */
export function removeNode(g: NodeGraph, nodeId: string): boolean {
  const idx = g.nodes.findIndex(n => n.id === nodeId);
  if (idx === -1) return false;
  g.nodes.splice(idx, 1);
  g.edges = g.edges.filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId);
  return true;
}

// ── Edge ops ─────────────────────────────────────────────────────────────────

/** Add an edge after validating direction, type compat, and acyclicity. */
export function addEdge(g: NodeGraph, edge: Omit<Edge, 'id'>): Edge {
  if (edge.from.dir !== 'out') throw new Error('[graph] edge.from must be an output port');
  if (edge.to.dir   !== 'in')  throw new Error('[graph] edge.to must be an input port');

  const fromNode = g.nodes.find(n => n.id === edge.from.nodeId);
  const toNode   = g.nodes.find(n => n.id === edge.to.nodeId);
  if (!fromNode) throw new Error(`[graph] missing source node: ${edge.from.nodeId}`);
  if (!toNode)   throw new Error(`[graph] missing target node: ${edge.to.nodeId}`);

  const fromPort = getNodeDef(fromNode.type)?.outputs?.find(p => p.id === edge.from.portId);
  const toPort   = getNodeDef(toNode.type)?.inputs?.find(p => p.id === edge.to.portId);
  if (!fromPort) throw new Error(`[graph] missing output port: ${edge.from.portId}`);
  if (!toPort)   throw new Error(`[graph] missing input port:  ${edge.to.portId}`);

  if (!portsCompatible(fromPort.kind, toPort.kind)) {
    throw new Error(`[graph] incompatible ports: ${fromPort.kind} → ${toPort.kind}`);
  }

  const full: Edge = { id: mintEdgeId(), from: edge.from, to: edge.to };

  // Cycle check on the candidate graph
  if (createsCycle(g, full)) {
    throw new Error('[graph] edge would create a cycle');
  }

  g.edges.push(full);
  return full;
}

/** Remove by id. Returns true if removed. */
export function removeEdge(g: NodeGraph, edgeId: string): boolean {
  const idx = g.edges.findIndex(e => e.id === edgeId);
  if (idx === -1) return false;
  g.edges.splice(idx, 1);
  return true;
}

// ── Validation helpers ───────────────────────────────────────────────────────

function portsCompatible(a: PortKind, b: PortKind): boolean {
  return a === b || a === 'any' || b === 'any';
}

/** Does adding `candidate` to `g` create a directed cycle? DFS from candidate.to. */
function createsCycle(g: NodeGraph, candidate: Edge): boolean {
  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) adj.get(e.from.nodeId)?.push(e.to.nodeId);
  adj.get(candidate.from.nodeId)?.push(candidate.to.nodeId);

  // Walk from candidate.to; if we can reach candidate.from → cycle.
  const stack = [candidate.to.nodeId];
  const seen  = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === candidate.from.nodeId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const neighbours = adj.get(cur);
    if (neighbours) stack.push(...neighbours);
  }
  return false;
}

/** Utility: inbound edges for a specific input port — used by codegen. */
export function incomingEdges(g: NodeGraph, nodeId: string, portId: string): Edge[] {
  return g.edges.filter(e => e.to.nodeId === nodeId && e.to.portId === portId);
}

/**
 * Reconstruct a live NodeGraph from its persisted NodeGraphSnapshot.
 *
 * Preserves the original node + edge ids (so future serialization round-trips
 * stay stable) and advances the module-level id counters past the largest
 * restored id, so subsequent addNode / addEdge calls never collide with
 * hydrated ids.
 *
 * Nodes whose `defType` is not registered are dropped — the registry may not
 * have finished loading yet, and silently skipping is safer than throwing in
 * the middle of panel open. Edges that reference a dropped node, a missing
 * port, incompatible kinds, or would create a cycle are likewise skipped with
 * a warn-level log; the remaining graph stays valid.
 *
 * Note: Node.side isn't persisted in the snapshot (it's derivable from the
 * NodeDefinition), so we pull it from the registered def.
 */
export function graphFromSnapshot(snapshot: NodeGraphSnapshot): NodeGraph {
  // sweeperId isn't carried in the snapshot — the caller owns that context.
  // We reconstruct a graph with sweeperId=0; panel.ts overwrites it before use
  // (or we adjust the signature later if needed). For now, default to 0 so
  // the graph object is well-formed.
  const g: NodeGraph = { sweeperId: 0, nodes: [], edges: [] };

  for (const sn of snapshot.nodes) {
    const def = getNodeDef(sn.defType);
    if (!def) {
      console.warn(`[graph] graphFromSnapshot: unknown defType "${sn.defType}", skipping node ${sn.id}`);
      continue;
    }
    const side: NodeSide = def.side;
    const node: Node = {
      id:     sn.id,
      type:   sn.defType,
      side,
      x:      sn.x,
      y:      sn.y,
      params: { ...(def.defaultParams ?? {}), ...sn.params },
    };
    g.nodes.push(node);
  }

  for (const se of snapshot.edges) {
    // fromPort / toPort are stored as `${nodeId}:${portId}`.
    const [fromNodeId, fromPortId] = splitPortRef(se.fromPort);
    const [toNodeId,   toPortId]   = splitPortRef(se.toPort);
    if (fromNodeId === null || fromPortId === null || toNodeId === null || toPortId === null) {
      console.warn(`[graph] graphFromSnapshot: malformed edge ${se.id}, skipping`);
      continue;
    }
    const candidate = {
      from: { nodeId: fromNodeId, portId: fromPortId, dir: 'out' as const },
      to:   { nodeId: toNodeId,   portId: toPortId,   dir: 'in'  as const },
    };
    if (!canAddEdge(g, candidate)) {
      console.warn(`[graph] graphFromSnapshot: edge ${se.id} rejected (missing ports / cycle / kind mismatch)`);
      continue;
    }
    g.edges.push({ id: se.id, from: candidate.from, to: candidate.to });
  }

  advanceIdCountersPast(snapshot);
  return g;
}

function splitPortRef(ref: string): [string | null, string | null] {
  const idx = ref.indexOf(':');
  if (idx === -1) return [null, null];
  return [ref.slice(0, idx), ref.slice(idx + 1)];
}

/**
 * Pure, non-mutating validity check for a candidate edge. Mirrors the rules
 * enforced by `addEdge` (direction, port existence, kind compatibility,
 * acyclicity) but returns a boolean instead of throwing. Used by interactive
 * layers (see cables.ts) to light up compatible drop-targets during a drag.
 */
export function canAddEdge(g: NodeGraph, edge: Omit<Edge, 'id'>): boolean {
  if (edge.from.dir !== 'out') return false;
  if (edge.to.dir   !== 'in')  return false;

  const fromNode = g.nodes.find(n => n.id === edge.from.nodeId);
  const toNode   = g.nodes.find(n => n.id === edge.to.nodeId);
  if (!fromNode || !toNode) return false;

  const fromPort = getNodeDef(fromNode.type)?.outputs?.find(p => p.id === edge.from.portId);
  const toPort   = getNodeDef(toNode.type)?.inputs?.find(p => p.id === edge.to.portId);
  if (!fromPort || !toPort) return false;

  if (!portsCompatible(fromPort.kind, toPort.kind)) return false;

  const candidate: Edge = { id: '__dryrun', from: edge.from, to: edge.to };
  if (createsCycle(g, candidate)) return false;
  return true;
}
