// src/__tests__/node-editor-codegen.test.ts
//
// Unit 14 — Graph → Strudel codegen wiring (deferred).
//
// These tests target compileGraphToStrudel() in src/node-editor/codegen.ts.
// Sibling Units 6–10 that register real data/sound NodeDefinitions are not
// yet landed, so we register tiny in-test defs to exercise every code path:
//   • empty / null graph → baseline (byte-identical to shape._toSweeperCode)
//   • a sound-side `lpf` node alone  → `.lpf(...)` appended
//   • a data-side source feeding an lpf node → inbound signal() expression
//   • ordering respects chainOrder, then topo index

import { beforeEach, describe, expect, it } from 'vitest';
import { CanvasShape } from '../shapes';
import {
  addEdge,
  addNode,
  compileGraphToStrudel,
  createGraph,
  inboundSignalExpr,
  registerNodeDef,
} from '../node-editor';
import { _resetIdsForTests } from '../node-editor/graph';
import { _resetRegistryForTests } from '../node-editor/registry';
import type { NodeDefinition } from '../node-editor';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSweeper(): CanvasShape {
  const s = new CanvasShape(0, 0, 'sweeper', 400);
  s.k = 4;
  // No linkLines → sweepTicks stays empty → base code uses the silent fallback.
  return s;
}

function makeDef(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type' | 'side'>): NodeDefinition {
  return {
    label:         partial.label ?? partial.type,
    inputs:        partial.inputs  ?? [],
    outputs:       partial.outputs ?? [],
    defaultParams: partial.defaultParams ?? {},
    codegen:       partial.codegen ?? (() => ''),
    ...partial,
  };
}

beforeEach(() => {
  _resetRegistryForTests();
  _resetIdsForTests();
});

// ── Empty-graph baseline ─────────────────────────────────────────────────────

describe('compileGraphToStrudel — baseline', () => {
  it('null graph produces the exact pre-overhaul sweeper block', () => {
    const s = makeSweeper();
    const out = compileGraphToStrudel(s.id, null, s);
    expect(out).toBe(s.toStrudelCode());
  });

  it('empty graph (no nodes) produces the baseline block', () => {
    const s = makeSweeper();
    const g = createGraph(s.id);
    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).toBe(s.toStrudelCode());
  });

  it('graph with only unregistered node types produces the baseline block', () => {
    // No registerNodeDef call → addNode would fail. Build a raw graph instead.
    const s = makeSweeper();
    const g = createGraph(s.id);
    // Simulate a snapshot whose def is no longer loaded (forward-compat).
    g.nodes.push({ id: 'nX', type: 'sound.unknown', side: 'sound', x: 0, y: 0, params: {} });
    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).toBe(s.toStrudelCode());
  });
});

// ── Single sound-side node: `.lpf(800)` ──────────────────────────────────────

describe('compileGraphToStrudel — single sound-side node', () => {
  it('appends .lpf(...) fragment to the base chain', () => {
    registerNodeDef(makeDef({
      type: 'sound.lpf',
      side: 'sound',
      inputs:  [{ id: 'cutoff', label: 'cutoff', kind: 'signal' }],
      outputs: [{ id: 'out',    label: 'out',    kind: 'signal' }],
      defaultParams: { cutoff: 800 },
      codegen: (_ctx, params) => `.lpf(${params['cutoff'] as number})`,
    }));

    const s = makeSweeper();
    const g = createGraph(s.id);
    addNode(g, { type: 'sound.lpf', side: 'sound', x: 0, y: 0 });

    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).toContain('.lpf(800)');

    // Markers must survive the splice.
    expect(out).toContain(`// @shape-start-${s.id}`);
    expect(out).toContain(`// @shape-end-${s.id}`);

    // The terminating .p() call must still be present and last-ish.
    expect(out).toContain(`.p((${s.id}).toString())`);

    // Fragment must appear BEFORE the .p((id).toString()) tail.
    const lpfIdx = out.indexOf('.lpf(800)');
    const pIdx   = out.indexOf(`.p((${s.id}).toString())`);
    expect(lpfIdx).toBeGreaterThan(-1);
    expect(pIdx).toBeGreaterThan(lpfIdx);
  });
});

// ── Inbound data edge → signal() expression ──────────────────────────────────

describe('compileGraphToStrudel — inbound data edge', () => {
  it('produces a signal(() => globalThis.__sw_<id>_<out>) fragment', () => {
    // A data-side source publishes a continuous value at output 'value'.
    registerNodeDef(makeDef({
      type: 'data.source',
      side: 'data',
      outputs: [{ id: 'value', label: 'value', kind: 'signal', continuous: true }],
      codegen: () => '',
    }));

    // Sound-side node consumes the inbound edge and emits
    // `.lpf(signal(() => globalThis.__sw_<id>_value))`.
    registerNodeDef(makeDef({
      type: 'sound.lpf',
      side: 'sound',
      inputs:  [{ id: 'cutoff', label: 'cutoff', kind: 'signal' }],
      outputs: [{ id: 'out',    label: 'out',    kind: 'signal' }],
      defaultParams: { cutoff: 1000 },
      codegen: (ctx, params, inbound) => {
        const cutoffEdge = inbound.find(e => e.to.portId === 'cutoff');
        const expr = cutoffEdge !== undefined
          ? inboundSignalExpr(ctx.sweeperId, cutoffEdge.from.portId)
          : String(params['cutoff']);
        return `.lpf(${expr})`;
      },
    }));

    const s = makeSweeper();
    const g = createGraph(s.id);
    const src = addNode(g, { type: 'data.source', side: 'data',  x: 0, y: 0 });
    const lpf = addNode(g, { type: 'sound.lpf',   side: 'sound', x: 0, y: 0 });

    addEdge(g, {
      from: { nodeId: src.id, portId: 'value',  dir: 'out' },
      to:   { nodeId: lpf.id, portId: 'cutoff', dir: 'in' },
    });

    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).toContain(`.lpf(signal(() => globalThis.__sw_${s.id}_value))`);
  });
});

// ── Topological ordering ─────────────────────────────────────────────────────

describe('compileGraphToStrudel — fragment ordering', () => {
  it('chainOrder (lower first) wins over topo index', () => {
    // distort has chainOrder=10 so it MUST appear after lpf (chainOrder=1).
    registerNodeDef({
      type: 'sound.distort',
      side: 'sound',
      label: 'distort',
      inputs: [{ id: 'in', label: 'in', kind: 'signal' }],
      outputs: [],
      defaultParams: {},
      codegen: () => '.distort(0.5)',
      chainOrder: 10,
    } as NodeDefinition & { chainOrder: number });
    registerNodeDef({
      type: 'sound.lpf',
      side: 'sound',
      label: 'lpf',
      inputs: [{ id: 'cutoff', label: 'cutoff', kind: 'signal' }],
      outputs: [],
      defaultParams: {},
      codegen: () => '.lpf(800)',
      chainOrder: 1,
    } as NodeDefinition & { chainOrder: number });

    const s = makeSweeper();
    const g = createGraph(s.id);
    // Add distort FIRST (higher chainOrder) so topo order alone would break this.
    addNode(g, { type: 'sound.distort', side: 'sound', x: 0, y: 0 });
    addNode(g, { type: 'sound.lpf',     side: 'sound', x: 0, y: 0 });

    const out = compileGraphToStrudel(s.id, g, s);
    const lpfIdx     = out.indexOf('.lpf(800)');
    const distortIdx = out.indexOf('.distort(0.5)');
    expect(lpfIdx).toBeGreaterThan(-1);
    expect(distortIdx).toBeGreaterThan(-1);
    expect(lpfIdx).toBeLessThan(distortIdx);
  });

  it('falls back to topological order when chainOrder is absent', () => {
    // Two independent sound nodes; `a` is added first, `b` second, no edges.
    // Without chainOrder, insertion/topo order decides → `a` before `b`.
    registerNodeDef(makeDef({
      type: 'sound.a', side: 'sound',
      codegen: () => '.lpf(100)',
    }));
    registerNodeDef(makeDef({
      type: 'sound.b', side: 'sound',
      codegen: () => '.hpf(200)',
    }));
    const s = makeSweeper();
    const g = createGraph(s.id);
    addNode(g, { type: 'sound.a', side: 'sound', x: 0, y: 0 });
    addNode(g, { type: 'sound.b', side: 'sound', x: 0, y: 0 });
    const out = compileGraphToStrudel(s.id, g, s);
    const aIdx = out.indexOf('.lpf(100)');
    const bIdx = out.indexOf('.hpf(200)');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('data-side nodes are never emitted into the sound chain', () => {
    registerNodeDef(makeDef({
      type: 'data.only',
      side: 'data',
      outputs: [{ id: 'v', label: 'v', kind: 'signal' }],
      codegen: () => '.should-never-appear()',
    }));
    const s = makeSweeper();
    const g = createGraph(s.id);
    addNode(g, { type: 'data.only', side: 'data', x: 0, y: 0 });
    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).not.toContain('should-never-appear');
    // And the output should be byte-identical to the baseline.
    expect(out).toBe(s.toStrudelCode());
  });
});
