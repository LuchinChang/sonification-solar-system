// src/node-editor/codegen.ts
//
// Graph → Strudel codegen with PRE-BAKED PATTERNS (round 2 refactor).
//
// Two-pass pipeline, fanned out over (arm × slot):
//
//   Pass 1 — Stack resolution: for every (arm, slot) × every data-chip that
//            is referenced by a wired sound-chip edge, pre-compute a shared
//            `SweepStack` of length `shape.ticks` by calling the data chip's
//            `perTickValue(shape, arm, tick, slot, maxR)`. Cached per
//            (dataNodeId, arm, slot) so fan-out (one data chip → multiple
//            sound chips within the same voice) does not duplicate work.
//            `slot` comes from the iteration axis, not a chip param — this
//            is why `distance-to-sun`/`angle-variance` dropped their
//            `defaultParams.slot`.
//
//   Pass 2 — Voice synthesis: for each (arm, slot), walk sound-chip codegen
//            fns in topological order. Each sound chip reads its inbound
//            stack via `ctx.resolveInboundStack`, applies its own
//            curve/range transform, and emits a static Strudel chain
//            fragment (e.g. `.freq("100.00 141.42 … 282.84")`). Fragments
//            chain into a single voice tail-shaped as
//            `<frag1><frag2>…s("<instrument>")`. Voices across all
//            (arm, slot) pairs are stacked via `.stack()` so they sound
//            simultaneously. With defaults (`sweepCount=1, k=4`) that's 4
//            parallel voices — matching the legacy `_toSweeperCode()`
//            behavior restored in round 2.
//
// Unwired sound chips stay in the graph (so a cable swap is reversible) but
// contribute no fragment to the voice — preventing orphan `.freq(…)` /
// `.note(…)` leakage when a cable is swapped between chips.

import type { CanvasShape } from '../shapes';
import { getNodeDef } from './registry';
import type { CodegenCtx, Node, NodeGraph, SweepStack } from './types';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compile a live NodeGraph into the full Strudel sweeper block.
 *
 * Empty graph / no sound-side nodes → falls back to `shape.toStrudelCode()`
 * so the existing "default" block (baked from sweepTicks' internal freq/gain)
 * still renders when the editor hasn't placed anything yet.
 */
export function compileGraphToStrudel(
  sweeperId: number,
  graph: NodeGraph | null,
  shape: CanvasShape,
): string {
  const baseBlock = shape.toStrudelCode();
  if (graph === null || graph.nodes.length === 0) return baseBlock;

  const soundNodes = graph.nodes.filter(n => {
    const def = getNodeDef(n.type);
    return def?.side === 'sound';
  });
  if (soundNodes.length === 0) return baseBlock;

  // Fan out to (sweepCount × k) voices. Each (arm, slot) pair reads the
  // slot-specific cluster values from the data chips, so with default k=4
  // the user hears 4 parallel pitch/gain stacks per arm — matching the
  // legacy `_toSweeperCode()` output.
  const k = Math.max(1, shape.k);
  const voices: string[] = [];
  for (let arm = 0; arm < shape.sweepCount; arm++) {
    for (let slot = 0; slot < k; slot++) {
      voices.push(buildVoiceForArmSlot(sweeperId, graph, shape, arm, slot, soundNodes));
    }
  }

  // Ping-pong: Strudel's `.palindrome()` operates on the final patterned chain
  // so the baked pattern plays forward/backward on alternating cycles.
  if (shape.playbackMode === 'ping-pong') {
    voices[voices.length - 1] += '.palindrome()';
  }

  return assembleBlock(shape, voices);
}

// ── Voice synthesis (Pass 2) ────────────────────────────────────────────────

function buildVoiceForArmSlot(
  sweeperId:  number,
  graph:      NodeGraph,
  shape:      CanvasShape,
  arm:        number,
  slot:       number,
  soundNodes: Node[],
): string {
  // Pass 1 — shared stack cache keyed on (dataNodeId, arm, slot). Slot comes
  // from the codegen-level iteration axis, not a data-chip param — so
  // cluster-count(slot=0) vs cluster-count(slot=3) can legitimately produce
  // different stacks within the same (arm) and must cache separately.
  const stackCache = new Map<string, SweepStack>();

  const getStack = (dataNodeId: string): SweepStack | null => {
    const key = `${dataNodeId}@${arm}@${slot}`;
    const cached = stackCache.get(key);
    if (cached) return cached;

    const dataNode = graph.nodes.find(n => n.id === dataNodeId);
    if (!dataNode) return null;
    const def = getNodeDef(dataNode.type);
    if (!def?.perTickValue) return null;

    const maxR = shape.sweepMaxR > 0 ? shape.sweepMaxR : shape.size;

    const stack: SweepStack = new Array(shape.ticks);
    for (let t = 0; t < shape.ticks; t++) {
      const v = def.perTickValue(shape, arm, t, slot, maxR);
      // Defensive clamp — data chips should already emit 0..1, but a buggy
      // third-party chip shouldn't poison the sound-chip transform.
      stack[t] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    stackCache.set(key, stack);
    return stack;
  };

  const ctx: CodegenCtx = {
    sweeperId,
    nodeVar: (nodeId) => `sw_${sweeperId}_${nodeId}`,
    incoming: (nodeId, portId) =>
      graph.edges.filter(e => e.to.nodeId === nodeId && e.to.portId === portId),
    paramsOf: <T = Record<string, unknown>>(nodeId: string): T => {
      const n = graph.nodes.find(x => x.id === nodeId);
      if (!n) throw new Error(`[codegen] paramsOf: unknown node ${nodeId}`);
      return n.params as T;
    },
    resolveInboundStack(nodeId, portId) {
      const edges = graph.edges.filter(e => e.to.nodeId === nodeId && e.to.portId === portId);
      if (edges.length === 0) return null;
      const src = edges[0]!;
      return getStack(src.from.nodeId);
    },
  };

  const ordered  = topoFilter(graph, soundNodes);
  const fragments: string[] = [];
  for (const node of ordered) {
    const def = getNodeDef(node.type);
    if (!def || def.side !== 'sound') continue;
    const inbound = graph.edges.filter(e => e.to.nodeId === node.id);
    // Orphan sound chips (chips that declare input ports but have none
    // wired) stay in the graph so the user can reconnect them, but they
    // contribute no fragment — otherwise a stale .freq(…)/.note(…) leaks
    // into the textarea after a cable swap. Chips with no declared inputs
    // (pure param-emitters) are exempt: they're not "orphans", they're
    // always-on utility fragments (e.g. a hypothetical `.palindrome()` chip).
    const hasInputs = (def.inputs?.length ?? 0) > 0;
    if (hasInputs && inbound.length === 0) continue;
    const frag = def.codegen(ctx, node.params, inbound);
    if (frag === '') continue;
    fragments.push(frag.startsWith('.') ? frag : `.${frag}`);
  }

  // Strudel's pattern combinators inherit time-structure from the LEFTMOST
  // creator. If we start with `s("sawtooth")` (one event per cycle) and chain
  // `.freq("v0 v1 … v119")` after it, all 120 freq values collapse into that
  // single event's (0,1) span and play simultaneously — no sequential pitch
  // pattern, and generator changes barely affect the resulting drone. The
  // legacy `toStrudelCode()` avoids this by putting `.s("…")` at the TAIL:
  // the first baked fragment (`freq("…")`) owns the structure, modifiers
  // chain, and the synth voice is selected last. Mirror that shape here.
  const body = fragments.join('');
  const instrument = shape.instrument;
  // Every wired chip was skipped (all orphans in this (arm, slot) voice) —
  // emit a muted voice so the user isn't greeted by a drone when they
  // intentionally disconnect everything.
  if (body === '') return `s("${instrument}").gain(0)`;
  const head = body.startsWith('.') ? body.slice(1) : body;
  return `${head}.s("${instrument}")`;
}

// ── Block assembly ──────────────────────────────────────────────────────────

function assembleBlock(shape: CanvasShape, voices: string[]): string {
  const startMarker = `// @shape-start-${shape.id}`;
  const endMarker   = `// @shape-end-${shape.id}`;
  const deg         = (shape.startAngle * 180 / Math.PI).toFixed(1);
  const armLabel    = shape.sweepCount > 1 ? `, arms=${shape.sweepCount}` : '';
  const comment     = `// [Sweeper ${shape.id}: k=${shape.k}${armLabel}, s="${shape.instrument}", 12o'clock=${deg}°]`;

  // voices[0] + .stack(voices[1]) + .stack(voices[2]) + … + .p((id).toString())
  const head = voices[0] ?? `s("${shape.instrument}").gain(0)`;
  const rest = voices.slice(1).map(v => `.stack(\n  ${v}\n)`).join('');
  const pat  = `${head}${rest}\n  .p((${shape.id}).toString())`;

  return [startMarker, comment, pat, endMarker].join('\n');
}

// ── Topological filter ──────────────────────────────────────────────────────
//
// Keep the stable topo ordering of the original codegen (Kahn's algorithm,
// preserving insertion order when indegree is zero), then filter down to
// just the requested set. Callers pass `soundNodes`; returned order is their
// topological order within the full graph.

function topoFilter(g: NodeGraph, restrictTo: Node[]): Node[] {
  const byId = new Map<string, Node>();
  for (const n of g.nodes) byId.set(n.id, n);

  const indeg = new Map<string, number>();
  for (const n of g.nodes) indeg.set(n.id, 0);
  for (const e of g.edges) {
    indeg.set(e.to.nodeId, (indeg.get(e.to.nodeId) ?? 0) + 1);
  }

  const adj = new Map<string, string[]>();
  for (const n of g.nodes) adj.set(n.id, []);
  for (const e of g.edges) adj.get(e.from.nodeId)?.push(e.to.nodeId);

  const queue: string[] = [];
  for (const n of g.nodes) if ((indeg.get(n.id) ?? 0) === 0) queue.push(n.id);

  const out: Node[] = [];
  const keep = new Set(restrictTo.map(n => n.id));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node && keep.has(id)) out.push(node);
    for (const next of adj.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return out;
}

// ── Helper: value-stack → whitespace-separated pattern string ───────────────
//
// Exported so individual sound-chip `codegen` fns don't each re-implement the
// same formatting. Chunks into 8-per-line so large `ticks` (e.g. 360) don't
// explode the textarea into a single megaline.

/**
 * Map a raw 0..1 stack through a curve and min/max range, formatting the
 * result as a Strudel pattern-string fragment: `v0 v1 … vN`.
 *
 * Callers wrap the returned string in backticks (template literals), e.g.
 * `.freq(\`${bakePattern(stack, 100, 1000, 'exp')}\`)`. We chunk values
 * 8-per-line for readability, which means the baked string contains raw
 * newlines — valid inside backticks, but a SyntaxError inside `"..."`
 * ("unterminated string constant"). Strudel's mini-notation treats
 * whitespace (including newlines) as event separators.
 */
export function bakePattern(
  stack: SweepStack,
  min: number,
  max: number,
  curve: 'linear' | 'exp' | 'quadratic' = 'linear',
  precision = 2,
): string {
  const vals: string[] = new Array(stack.length);
  for (let i = 0; i < stack.length; i++) {
    vals[i] = mapValue(stack[i]!, min, max, curve).toFixed(precision);
  }
  // 8 values per line for readability.
  const rows: string[] = [];
  for (let i = 0; i < vals.length; i += 8) {
    rows.push(vals.slice(i, i + 8).join(' '));
  }
  return rows.join('\n    ');
}

export function mapValue(
  v: number,
  min: number,
  max: number,
  curve: 'linear' | 'exp' | 'quadratic',
): number {
  const x = v < 0 ? 0 : v > 1 ? 1 : v;
  switch (curve) {
    case 'linear':    return min + x * (max - min);
    case 'quadratic': return min + x * x * (max - min);
    case 'exp':       {
      // Equal-ratio steps (musical). Requires positive min/max.
      if (min <= 0 || max <= 0) return min + x * (max - min);
      return min * Math.pow(max / min, x);
    }
  }
}
