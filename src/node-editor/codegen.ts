// src/node-editor/codegen.ts
//
// Unit 14 — Graph → Strudel codegen (DEFERRED COMMIT).
//
// Walks an in-memory NodeGraph and emits a full sweeper block
// (// @shape-start-N … // @shape-end-N) suitable for splicing into the live
// Strudel textarea via telemetry.ts's patchShapeBlock.
//
// Invariants:
//   • Pure string-building — no DOM, no audio, no side-effects.
//   • Cycle-free graphs only (graph.ts rejects cycles on addEdge).
//   • An empty graph (or one whose nodes have no registered NodeDefinitions)
//     must produce byte-identical output to shape._toSweeperCode() — the
//     pre-Unit-14 baseline — so enabling the editor is a no-op until the
//     user actually wires something.
//
// Fragment composition:
//   base = freq(…).gain(…).s(…).stack(…)
//   full = base<fragments>.p((id).toString())
// Fragments come from sound-side NodeDefinition.codegen() in topological order,
// biased by an optional chainOrder on each def (lower first; undefined = 0).

import type { CanvasShape } from '../shapes';
import { getNodeDef } from './registry';
import type { CodegenCtx, Node, NodeDefinition, NodeGraph } from './types';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compile a live NodeGraph into the full Strudel sweeper block.
 *
 * Returns the same thing shape._toSweeperCode() would return but with any
 * sound-side node fragments spliced in. Markers (`// @shape-start-N`,
 * `// @shape-end-N`) are preserved so telemetry.patchShapeBlock() can swap
 * the block in place.
 */
export function compileGraphToStrudel(
  sweeperId: number,
  graph: NodeGraph | null,
  shape: CanvasShape,
): string {
  const baseBlock = shape.toStrudelCode();

  // Short-circuit: no graph, empty graph, or no sound-side nodes → baseline.
  if (graph === null || graph.nodes.length === 0) return baseBlock;

  const fragments = buildFragments(sweeperId, graph);
  if (fragments.length === 0) return baseBlock;

  return spliceFragmentsIntoBlock(baseBlock, sweeperId, fragments);
}

// ── Fragment assembly ────────────────────────────────────────────────────────

/**
 * Walk the graph in topological order, call each sound-side node's codegen,
 * collect fragments. Nodes whose type is not in the registry are skipped
 * (lets Unit 14 land before Units 6–10 register their defs).
 */
function buildFragments(sweeperId: number, graph: NodeGraph): string[] {
  const order = topoSort(graph);
  const ctx   = makeCtx(sweeperId, graph);

  // Gather (chainOrder, topoIndex, fragment) tuples so we can sort stably.
  const tagged: Array<{ chain: number; topo: number; frag: string }> = [];
  for (let i = 0; i < order.length; i++) {
    const node = order[i];
    const def  = getNodeDef(node.type);
    if (!def)          continue;
    if (def.side !== 'sound') continue;

    const inbound = graph.edges.filter(e => e.to.nodeId === node.id);
    const frag    = def.codegen(ctx, node.params, inbound);
    if (frag === '') continue;

    tagged.push({
      chain: chainOrderOf(def),
      topo:  i,
      frag,
    });
  }

  // Stable: primary = chainOrder, secondary = topo index.
  tagged.sort((a, b) => a.chain - b.chain || a.topo - b.topo);
  return tagged.map(t => t.frag);
}

/** NodeDefinition may carry an optional chainOrder; fall back to 0. */
function chainOrderOf(def: NodeDefinition): number {
  const raw = (def as NodeDefinition & { chainOrder?: number }).chainOrder;
  return typeof raw === 'number' ? raw : 0;
}

// ── Codegen context ──────────────────────────────────────────────────────────

function makeCtx(sweeperId: number, graph: NodeGraph): CodegenCtx {
  return {
    sweeperId,
    nodeVar: (nodeId) => `sw_${sweeperId}_${nodeId}`,
    incoming: (nodeId, portId) =>
      graph.edges.filter(e => e.to.nodeId === nodeId && e.to.portId === portId),
    paramsOf: <T = Record<string, unknown>>(nodeId: string): T => {
      const n = graph.nodes.find(x => x.id === nodeId);
      if (!n) throw new Error(`[codegen] paramsOf: unknown node ${nodeId}`);
      return n.params as T;
    },
  };
}

/**
 * Strudel expression that reads the live value written by the render loop.
 * Used by node codegen when an input port has an inbound edge — the source
 * node is assumed to publish a global `globalThis.__sw_<id>_<outName>`.
 *
 * Exported so sibling units (6–10) can build consistent inbound expressions
 * without re-deriving the naming convention.
 */
export function inboundSignalExpr(sweeperId: number, outPortId: string): string {
  return `signal(() => globalThis.__sw_${sweeperId}_${outPortId})`;
}

// ── Topological sort (Kahn's algorithm) ──────────────────────────────────────
//
// Kahn preserves insertion order when the graph has no edges, so the "no-
// edges" fallback-to-topo-order path is deterministic and intuitive (nodes
// come out in the order the user added them).

function topoSort(g: NodeGraph): Node[] {
  const byId = new Map<string, Node>();
  for (const n of g.nodes) byId.set(n.id, n);

  const indeg = new Map<string, number>();
  for (const n of g.nodes) indeg.set(n.id, 0);
  for (const e of g.edges) {
    indeg.set(e.to.nodeId, (indeg.get(e.to.nodeId) ?? 0) + 1);
  }

  // Adjacency for fast successor lookup.
  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) adj.get(e.from.nodeId)?.push(e.to.nodeId);

  // Seed the queue with zero-indegree nodes in insertion order.
  const queue: string[] = [];
  for (const n of g.nodes) if ((indeg.get(n.id) ?? 0) === 0) queue.push(n.id);

  const out: Node[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node) out.push(node);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  // If a cycle existed we'd have unseen nodes; graph.ts rejects those upstream
  // so we don't try to recover here. Missing nodes would be silently dropped.
  return out;
}

// ── Fragment splicing ────────────────────────────────────────────────────────

/**
 * Insert `fragments` just before the terminating `.p((id).toString())` line
 * in an existing sweeper block, preserving the surrounding markers and
 * comment header emitted by shape._toSweeperCode().
 */
function spliceFragmentsIntoBlock(
  block: string,
  sweeperId: number,
  fragments: string[],
): string {
  // Matches the `.p((id).toString())` tail, including the leading newline+indent.
  const tailRegex = new RegExp(`(\\n\\s*)\\.p\\(\\(${sweeperId}\\)\\.toString\\(\\)\\)`);
  const m = tailRegex.exec(block);
  const joined = fragments.map(f => f.startsWith('.') ? f : `.${f}`).join('');

  if (!m) {
    // No tail found (shouldn't happen) — append fragments to end, safest fallback.
    return `${block}${joined}`;
  }
  const indent = m[1];
  return block.replace(tailRegex, `${indent}${joined}${indent}.p((${sweeperId}).toString())`);
}
