// src/__tests__/node-editor-codegen.test.ts
//
// compileGraphToStrudel() — pre-baked pipeline.
//
// The two-pass codegen:
//   1. For each arm, cache a 0..1 `SweepStack` per data chip referenced by
//      a wired sound chip (via NodeDefinition.perTickValue).
//   2. For each arm, build one voice `s("<instrument>")<frags>...`, where
//      each wired sound chip's codegen bakes a static Strudel pattern from
//      its inbound stack. Voices across arms are stacked via `.stack()`.

import { beforeEach, describe, expect, it } from 'vitest';
import { CanvasShape } from '../shapes';
import {
  addEdge,
  addNode,
  compileGraphToStrudel,
  createGraph,
  registerNodeDef,
} from '../node-editor';
import { _resetIdsForTests } from '../node-editor/graph';
import { _resetRegistryForTests } from '../node-editor/registry';
import type { NodeDefinition } from '../node-editor';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSweeper(): CanvasShape {
  const s = new CanvasShape(0, 0, 'sweeper', 400);
  s.k = 4;
  s.ticks = 8;           // short pattern for compact test assertions
  s.sweepMaxR = 400;
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
  it('null graph produces the pre-overhaul sweeper block', () => {
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
    const s = makeSweeper();
    const g = createGraph(s.id);
    g.nodes.push({ id: 'nX', type: 'sound.unknown', side: 'sound', x: 0, y: 0, params: {} });
    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).toBe(s.toStrudelCode());
  });

  it('graph with only data-side nodes (no sound) produces the baseline block', () => {
    registerNodeDef(makeDef({
      type: 'data.only', side: 'data',
      outputs: [{ id: 'v', label: 'v', kind: 'number' }],
      perTickValue: () => 0.5,
    }));
    const s = makeSweeper();
    const g = createGraph(s.id);
    addNode(g, { type: 'data.only', side: 'data', x: 0, y: 0 });
    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).toBe(s.toStrudelCode());
  });
});

// ── Wired sound chip: bakes a static pattern ─────────────────────────────────

describe('compileGraphToStrudel — wired sound chip', () => {
  it('bakes a whitespace-separated pattern from the inbound 0..1 stack', () => {
    // data chip emits a constant 0.5 across all ticks.
    registerNodeDef(makeDef({
      type: 'data.const', side: 'data',
      outputs: [{ id: 'v', label: 'v', kind: 'number' }],
      perTickValue: () => 0.5,
    }));

    // Sound chip that maps linearly 0..1 -> [100, 200] and emits .freq("…").
    registerNodeDef(makeDef({
      type: 'sound.f', side: 'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'number' }],
      defaultParams: { min: 100, max: 200 },
      codegen(ctx, params, inbound) {
        const edge = inbound.find(e => e.to.portId === 'in');
        if (!edge) return `.freq(${params['min']})`;
        const stack = ctx.resolveInboundStack(edge.to.nodeId, 'in');
        if (!stack) return `.freq(${params['min']})`;
        const min = params['min'] as number;
        const max = params['max'] as number;
        const vals = stack.map(v => (min + v * (max - min)).toFixed(0));
        return `.freq("${vals.join(' ')}")`;
      },
    }));

    const s = makeSweeper();
    const g = createGraph(s.id);
    const d = addNode(g, { type: 'data.const', side: 'data', x: 0, y: 0 });
    const f = addNode(g, { type: 'sound.f',    side: 'sound', x: 0, y: 0 });
    addEdge(g, {
      from: { nodeId: d.id, portId: 'v',  dir: 'out' },
      to:   { nodeId: f.id, portId: 'in', dir: 'in' },
    });

    const out = compileGraphToStrudel(s.id, g, s);

    // 0.5 → 150 Hz. shape.ticks = 8 so the pattern is eight "150"s.
    // Note: the first fragment has its leading `.` stripped so it acts as
    // the pattern's structure root (Strudel inherits time-structure from
    // the leftmost creator). The `.s("<instrument>")` goes at the tail.
    expect(out).toContain('freq("150 150 150 150 150 150 150 150")');

    // Voice ends with `.s("<instrument>")` and includes .p(id).
    expect(out).toContain(`.s("${s.instrument}")`);
    expect(out).toContain(`.p((${s.id}).toString())`);
    expect(out).toContain(`// @shape-start-${s.id}`);
    expect(out).toContain(`// @shape-end-${s.id}`);
  });

  it('unwired sound chip emits the param fallback scalar, not a baked pattern', () => {
    registerNodeDef(makeDef({
      type: 'sound.f', side: 'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'number' }],
      defaultParams: { min: 100, max: 200 },
      codegen(_ctx, params, inbound) {
        const edge = inbound.find(e => e.to.portId === 'in');
        if (!edge) return `.freq(${params['min']})`;
        return '.freq("should-not-reach")';
      },
    }));

    const s = makeSweeper();
    const g = createGraph(s.id);
    addNode(g, { type: 'sound.f', side: 'sound', x: 0, y: 0 });

    const out = compileGraphToStrudel(s.id, g, s);
    // Single-fragment voice: `.freq(100)` has its leading `.` stripped so
    // the voice is `freq(100).s("<instrument>")`.
    expect(out).toContain('freq(100)');
    expect(out).not.toContain('should-not-reach');
  });

  it('never emits signal(() => globalThis.__sw_…) — all values are baked', () => {
    // Regression guard: the pre-bake refactor fully removed the live-signal
    // emission path. A wired data chip must result in a string pattern, not
    // a runtime signal() callback.
    registerNodeDef(makeDef({
      type: 'data.const', side: 'data',
      outputs: [{ id: 'v', label: 'v', kind: 'number' }],
      perTickValue: () => 0.3,
    }));
    registerNodeDef(makeDef({
      type: 'sound.f', side: 'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'number' }],
      codegen(ctx, _params, inbound) {
        const edge = inbound.find(e => e.to.portId === 'in');
        if (!edge) return '.freq(440)';
        const stack = ctx.resolveInboundStack(edge.to.nodeId, 'in');
        if (!stack) return '.freq(440)';
        return `.freq("${stack.map(v => (v * 1000).toFixed(0)).join(' ')}")`;
      },
    }));

    const s = makeSweeper();
    const g = createGraph(s.id);
    const d = addNode(g, { type: 'data.const', side: 'data', x: 0, y: 0 });
    const f = addNode(g, { type: 'sound.f',    side: 'sound', x: 0, y: 0 });
    addEdge(g, {
      from: { nodeId: d.id, portId: 'v',  dir: 'out' },
      to:   { nodeId: f.id, portId: 'in', dir: 'in' },
    });

    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).not.toContain('signal(');
    expect(out).not.toContain('globalThis.__sw_');
  });
});

// ── Fan-out: one data chip → multiple sound chips ────────────────────────────

describe('compileGraphToStrudel — fan-out', () => {
  it('a single data chip feeds multiple sound chips, each with its own transform', () => {
    registerNodeDef(makeDef({
      type: 'data.src', side: 'data',
      outputs: [{ id: 'v', label: 'v', kind: 'number' }],
      perTickValue: () => 0.25,
    }));
    registerNodeDef(makeDef({
      type: 'sound.hi', side: 'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'number' }],
      codegen(ctx, _params, inbound) {
        const edge = inbound.find(e => e.to.portId === 'in');
        const stack = edge ? ctx.resolveInboundStack(edge.to.nodeId, 'in') : null;
        if (!stack) return '.hi(0)';
        return `.hi("${stack.map(v => (v * 1000).toFixed(0)).join(' ')}")`;
      },
    }));
    registerNodeDef(makeDef({
      type: 'sound.lo', side: 'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'number' }],
      codegen(ctx, _params, inbound) {
        const edge = inbound.find(e => e.to.portId === 'in');
        const stack = edge ? ctx.resolveInboundStack(edge.to.nodeId, 'in') : null;
        if (!stack) return '.lo(0)';
        return `.lo("${stack.map(v => (v * 10).toFixed(1)).join(' ')}")`;
      },
    }));

    const s = makeSweeper();
    const g = createGraph(s.id);
    const d  = addNode(g, { type: 'data.src', side: 'data',  x: 0, y: 0 });
    const hi = addNode(g, { type: 'sound.hi', side: 'sound', x: 0, y: 0 });
    const lo = addNode(g, { type: 'sound.lo', side: 'sound', x: 0, y: 0 });
    addEdge(g, { from: { nodeId: d.id, portId: 'v', dir: 'out' }, to: { nodeId: hi.id, portId: 'in', dir: 'in' } });
    addEdge(g, { from: { nodeId: d.id, portId: 'v', dir: 'out' }, to: { nodeId: lo.id, portId: 'in', dir: 'in' } });

    const out = compileGraphToStrudel(s.id, g, s);
    // 0.25 * 1000 = 250, 0.25 * 10 = 2.5 — both patterns of length 8.
    // The first fragment loses its leading `.`; the second keeps it.
    expect(out).toContain('hi("250 250 250 250 250 250 250 250")');
    expect(out).toContain('.lo("2.5 2.5 2.5 2.5 2.5 2.5 2.5 2.5")');
  });
});

// ── Playback mode: .palindrome() appended when ping-pong ────────────────────

describe('compileGraphToStrudel — playback mode', () => {
  it('emits .palindrome() at the tail when shape.playbackMode === "ping-pong"', () => {
    registerNodeDef(makeDef({
      type: 'sound.f', side: 'sound',
      inputs: [],
      codegen: () => '.gain(0.5)',
    }));
    const s = makeSweeper();
    s.playbackMode = 'ping-pong';
    const g = createGraph(s.id);
    addNode(g, { type: 'sound.f', side: 'sound', x: 0, y: 0 });

    const out = compileGraphToStrudel(s.id, g, s);
    const palIdx = out.indexOf('.palindrome()');
    const pIdx   = out.indexOf(`.p((${s.id}).toString())`);
    expect(palIdx).toBeGreaterThan(-1);
    expect(pIdx).toBeGreaterThan(palIdx);
  });

  it('does NOT emit .palindrome() when mode is "normal"', () => {
    registerNodeDef(makeDef({
      type: 'sound.f', side: 'sound',
      codegen: () => '.gain(0.5)',
    }));
    const s = makeSweeper();
    s.playbackMode = 'normal';
    const g = createGraph(s.id);
    addNode(g, { type: 'sound.f', side: 'sound', x: 0, y: 0 });

    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).not.toContain('.palindrome()');
  });
});

// ── Bug 1 regression: voice structure ───────────────────────────────────────
//
// Strudel inherits time-structure from the leftmost pattern creator. If the
// voice begins with `s("sawtooth")` (1 event per cycle) and a baked
// `.freq("v0 v1 … v119")` follows, all 120 freq values collapse into that
// single event's (0,1) span and fire simultaneously as a chord — losing
// the per-tick pattern AND making generator switches (sine↔sawtooth) barely
// audible. The fix is to put `.s("<instrument>")` at the TAIL, same shape
// as `toStrudelCode()`'s legacy path.

describe('compileGraphToStrudel — voice structure (Bug 1 regression)', () => {
  beforeEach(() => {
    _resetRegistryForTests();
    _resetIdsForTests();
  });

  it('does NOT start with s("<instrument>") — that would collapse pattern structure', () => {
    registerNodeDef(makeDef({
      type: 'data.c', side: 'data',
      outputs: [{ id: 'v', label: 'v', kind: 'number' }],
      perTickValue: () => 0.5,
    }));
    registerNodeDef(makeDef({
      type: 'sound.f', side: 'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'number' }],
      codegen(ctx, _params, inbound) {
        const edge = inbound[0];
        const stack = edge ? ctx.resolveInboundStack(edge.to.nodeId, edge.to.portId) : null;
        return stack ? `.freq("${stack.map(() => '150').join(' ')}")` : '.freq(150)';
      },
    }));
    const s = makeSweeper();
    s.instrument = 'sawtooth';
    const g = createGraph(s.id);
    const d = addNode(g, { type: 'data.c',  side: 'data',  x: 0, y: 0 });
    const f = addNode(g, { type: 'sound.f', side: 'sound', x: 0, y: 0 });
    addEdge(g, {
      from: { nodeId: d.id, portId: 'v',  dir: 'out' },
      to:   { nodeId: f.id, portId: 'in', dir: 'in' },
    });
    const out = compileGraphToStrudel(s.id, g, s);
    // The voice must NOT open with `s("sawtooth")` — that would sit to the
    // left of freq() and swallow the pattern structure.
    const voiceStart = out.indexOf(`s("sawtooth")`);
    const freqStart  = out.indexOf('freq("');
    expect(freqStart).toBeGreaterThan(-1);
    expect(voiceStart).toBeGreaterThan(freqStart);
  });

  it('ends the voice with .s("<instrument>") after freq/gain modifiers', () => {
    registerNodeDef(makeDef({
      type: 'sound.g', side: 'sound',
      codegen: () => '.gain(0.5)',
    }));
    const s = makeSweeper();
    s.instrument = 'triangle';
    const g = createGraph(s.id);
    addNode(g, { type: 'sound.g', side: 'sound', x: 0, y: 0 });
    const out = compileGraphToStrudel(s.id, g, s);
    // With one fragment `.gain(0.5)`, the voice is `gain(0.5).s("triangle")`.
    expect(out).toContain(`gain(0.5).s("triangle")`);
  });

  it('empty-fragments voice falls back to bare s("<instrument>")', () => {
    // A sound chip whose codegen returns '' should skip its fragment. If the
    // whole voice has nothing, emit `s("<instrument>")` (one-event drone)
    // rather than a malformed leading `.s(...)`.
    registerNodeDef(makeDef({
      type: 'sound.noop', side: 'sound',
      codegen: () => '',
    }));
    const s = makeSweeper();
    s.instrument = 'square';
    const g = createGraph(s.id);
    addNode(g, { type: 'sound.noop', side: 'sound', x: 0, y: 0 });
    const out = compileGraphToStrudel(s.id, g, s);
    // Voice fragment: bare `s("square")`. Must not start with `.s`.
    expect(out).toContain(`s("square")`);
    expect(out).not.toMatch(/\n\s*\.s\("square"\)/);
  });
});

// ── Data-side isolation: never emitted into sound chain ─────────────────────

describe('compileGraphToStrudel — data-side isolation', () => {
  it('data-side nodes do not emit codegen fragments into the voice', () => {
    registerNodeDef(makeDef({
      type: 'data.only', side: 'data',
      outputs: [{ id: 'v', label: 'v', kind: 'number' }],
      codegen: () => '.should-never-appear()',
      perTickValue: () => 0.5,
    }));
    const s = makeSweeper();
    const g = createGraph(s.id);
    addNode(g, { type: 'data.only', side: 'data', x: 0, y: 0 });
    const out = compileGraphToStrudel(s.id, g, s);
    expect(out).not.toContain('should-never-appear');
    // Without any sound chips wired, we short-circuit to baseline.
    expect(out).toBe(s.toStrudelCode());
  });
});
