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

import { getNodeDef } from './registry';
import type { Edge, Node, NodeGraph, PortKind } from './types';

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
