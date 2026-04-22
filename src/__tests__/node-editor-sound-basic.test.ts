// src/__tests__/node-editor-sound-basic.test.ts
//
// Sound-basic nodes — pre-baked pipeline.
//
// These tests exercise the four sound-side NodeDefinitions:
//   • sound.pitch      — chromatic-quantized note strings
//   • sound.frequency  — exp-curve Hz pattern
//   • sound.lpf        — exp-curve Hz pattern
//   • sound.gain       — quadratic 0..1 pattern
//
// Plus the seedDefaultGraph helper used by panel.openEditor().

import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerNodeDef,
  getNodeDef,
  createGraph,
  addNode,
  addEdge,
  incomingEdges,
} from '../node-editor';
import { _resetRegistryForTests } from '../node-editor/registry';
import { _resetIdsForTests } from '../node-editor/graph';
import type { CodegenCtx, NodeGraph, SweepStack } from '../node-editor';

import { registerSoundBasicNodes } from '../node-editor/nodes/sound-basic';
import { _seedDefaultGraphForTests } from '../node-editor/panel';
import { quantizeNote, installQuantizeHelper } from '../node-editor/codegen-helpers';

// ── CodegenCtx factory (with a configurable stack resolver) ─────────────────

function makeCtx(
  sweeperId: number,
  g: NodeGraph,
  stacks: Record<string, SweepStack> = {},
): CodegenCtx {
  return {
    sweeperId,
    nodeVar: (nodeId) => `sw_${sweeperId}_${nodeId}`,
    incoming: (nodeId, portId) => incomingEdges(g, nodeId, portId),
    paramsOf: <T = Record<string, unknown>>(nodeId: string) =>
      (g.nodes.find(n => n.id === nodeId)?.params ?? {}) as T,
    resolveInboundStack: (nodeId, portId) => stacks[`${nodeId}:${portId}`] ?? null,
  };
}

beforeEach(() => {
  _resetRegistryForTests();
  _resetIdsForTests();
  registerSoundBasicNodes();
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('sound-basic node definitions', () => {
  it('registers all four defs on the correct side', () => {
    for (const type of ['sound.pitch', 'sound.frequency', 'sound.lpf', 'sound.gain']) {
      const def = getNodeDef(type);
      expect(def, `missing def: ${type}`).toBeDefined();
      expect(def!.side).toBe('sound');
    }
  });

  it('has the expected defaultParams', () => {
    expect(getNodeDef('sound.pitch')!.defaultParams).toEqual({ note: 'c4', root: 'c4', span: 12 });
    expect(getNodeDef('sound.frequency')!.defaultParams).toEqual({ min: 100, max: 1000 });
    expect(getNodeDef('sound.lpf')!.defaultParams).toEqual({ min: 40, max: 200 });
    expect(getNodeDef('sound.gain')!.defaultParams).toEqual({ min: 0, max: 1 });
  });
});

// ── Unwired (static) codegen ─────────────────────────────────────────────────

describe('sound-basic codegen — unwired (static)', () => {
  it('sound.pitch emits .note(`<pattern>`) with the literal param', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.pitch', side: 'sound', x: 0, y: 0, params: { note: 'e4 g4' } });
    const out = getNodeDef('sound.pitch')!.codegen(makeCtx(1, g), n.params, []);
    // Backticks (not double quotes) — a baked multi-line pattern inside
    // "..." is a JS SyntaxError under Strudel's transpiler.
    expect(out).toBe('.note(`e4 g4`)');
  });

  it('sound.pitch falls back to c4 when note param is missing', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.pitch', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.pitch')!.codegen(makeCtx(1, g), n.params, []);
    expect(out).toBe('.note(`c4`)');
  });

  it('sound.frequency emits a scalar .freq(mid) when unwired (exp midpoint)', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.frequency', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.frequency')!.codegen(makeCtx(1, g), n.params, []);
    // exp midpoint of 100..1000 = 100 * sqrt(10) ≈ 316.23
    expect(out).toMatch(/^\.freq\(\d+\.\d+\)$/);
    const hz = parseFloat(out.replace('.freq(', '').replace(')', ''));
    expect(hz).toBeCloseTo(316.23, 1);
  });

  it('sound.lpf emits .lpf(mid) with new 40..200 default range', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.lpf', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.lpf')!.codegen(makeCtx(1, g), n.params, []);
    expect(out).toMatch(/^\.lpf\(\d+\.\d+\)$/);
    const hz = parseFloat(out.replace('.lpf(', '').replace(')', ''));
    // exp midpoint of 40..200 = 40 * sqrt(5) ≈ 89.44
    expect(hz).toBeCloseTo(89.44, 1);
  });

  it('sound.gain emits a scalar .gain(mid) (quadratic midpoint)', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.gain', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.gain')!.codegen(makeCtx(1, g), n.params, []);
    // 0.5^2 * 1 = 0.25
    expect(out).toBe('.gain(0.250)');
  });
});

// ── Wired (baked-pattern) codegen ────────────────────────────────────────────

describe('sound-basic codegen — wired (baked pattern)', () => {
  function wireDataToSound(
    sweeperId: number,
    soundType: string,
    soundParams: Record<string, unknown>,
    portId: string,
    stack: SweepStack,
  ): string {
    if (!getNodeDef('data.stub')) {
      registerNodeDef({
        type:  'data.stub',
        side:  'data',
        label: 'Stub',
        inputs:  [],
        outputs: [{ id: 'v', label: 'v', kind: 'number' }],
        defaultParams: {},
        codegen: () => '',
        perTickValue: () => 0,
      });
    }
    const g = createGraph(sweeperId);
    const src = addNode(g, { type: 'data.stub', side: 'data',  x: 0, y: 0 });
    const snd = addNode(g, { type: soundType,   side: 'sound', x: 0, y: 0, params: soundParams });
    const edge = addEdge(g, {
      from: { nodeId: src.id, portId: 'v',    dir: 'out' },
      to:   { nodeId: snd.id, portId,         dir: 'in' },
    });
    const ctx = makeCtx(sweeperId, g, { [`${snd.id}:${portId}`]: stack });
    return getNodeDef(soundType)!.codegen(ctx, snd.params, [edge]);
  }

  it('sound.frequency bakes an exp-curve pattern from the inbound stack', () => {
    const stack = [0, 0.5, 1];
    const out = wireDataToSound(7, 'sound.frequency', { min: 100, max: 1000 }, 'frequency', stack);
    // v=0 → 100, v=0.5 → 100*sqrt(10) ≈ 316.23, v=1 → 1000. The pattern is
    // wrapped in backticks (template-literal) so the "\n    " row breaks
    // that `bakePattern` inserts for 120/360-long patterns remain valid JS.
    expect(out).toContain('.freq(`');
    expect(out).toContain('100.00');
    expect(out).toContain('316.23');
    expect(out).toContain('1000.00');
  });

  it('sound.lpf bakes an exp-curve pattern over [40, 200]', () => {
    const stack = [0, 1];
    const out = wireDataToSound(2, 'sound.lpf', { min: 40, max: 200 }, 'frequency', stack);
    expect(out).toContain('.lpf(`');
    expect(out).toContain('40.00');
    expect(out).toContain('200.00');
  });

  it('sound.gain bakes a quadratic-curve pattern over [0, 1]', () => {
    const stack = [0, 0.5, 1];
    const out = wireDataToSound(3, 'sound.gain', { min: 0, max: 1 }, 'amp', stack);
    // quadratic: 0 → 0.000, 0.5 → 0.250, 1 → 1.000
    expect(out).toContain('.gain(`');
    expect(out).toContain('0.000');
    expect(out).toContain('0.250');
    expect(out).toContain('1.000');
  });

  it('sound.pitch bakes chromatic notes from the inbound 0..1 stack', () => {
    const stack = [0, 0.5, 0.999];
    const out = wireDataToSound(9, 'sound.pitch', { note: 'c4', root: 'c4', span: 12 }, 'note', stack);
    expect(out).toContain('.note(`');
    expect(out).toContain('c4');
    expect(out).toContain('f#4');
    expect(out).toContain('b4');
  });

  it('sound.pitch respects custom root/span', () => {
    const stack = [0.5];
    const out = wireDataToSound(2, 'sound.pitch', { note: 'c4', root: 'a4', span: 24 }, 'note', stack);
    // 0.5 * 24 = 12 → a4 + 12 = a5
    expect(out).toContain('a5');
  });

  it('never emits signal(() => globalThis.__sw_…) in the baked output', () => {
    const stack = [0, 1];
    const lpf  = wireDataToSound(4, 'sound.lpf',       { min: 40, max: 200 }, 'frequency', stack);
    const freq = wireDataToSound(5, 'sound.frequency', { min: 100, max: 1000 }, 'frequency', stack);
    const gain = wireDataToSound(6, 'sound.gain',      { min: 0, max: 1 }, 'amp', stack);
    for (const out of [lpf, freq, gain]) {
      expect(out).not.toContain('signal(');
      expect(out).not.toContain('globalThis.__sw_');
    }
  });
});

// ── Default graph seeding ────────────────────────────────────────────────────

describe('default graph seeding (openEditor)', () => {
  it('falls back to sound-only when Unit 6 data nodes are absent', () => {
    const g = _seedDefaultGraphForTests(123);
    expect(g.sweeperId).toBe(123);
    const types = g.nodes.map(n => n.type).sort();
    expect(types).toEqual(['sound.frequency', 'sound.gain']);
    expect(g.edges).toHaveLength(0);
  });

  it('seeds distance→sound.frequency and cluster-count→sound.gain when data nodes are registered', () => {
    registerNodeDef({
      type: 'data.distance-to-sun',
      side: 'data',
      label: 'Distance to Sun',
      inputs:  [],
      outputs: [{ id: 'distance', label: 'dist', kind: 'number' }],
      defaultParams: {},
      codegen: () => '',
      perTickValue: () => 0,
    });
    registerNodeDef({
      type: 'data.cluster-count',
      side: 'data',
      label: 'Cluster Count',
      inputs:  [],
      outputs: [{ id: 'count', label: 'count', kind: 'number' }],
      defaultParams: {},
      codegen: () => '',
      perTickValue: () => 0,
    });

    const g = _seedDefaultGraphForTests(42);

    const types = g.nodes.map(n => n.type).sort();
    expect(types).toEqual([
      'data.cluster-count',
      'data.distance-to-sun',
      'sound.frequency',
      'sound.gain',
    ]);
    expect(g.edges).toHaveLength(2);

    const distNode    = g.nodes.find(n => n.type === 'data.distance-to-sun')!;
    const clusterNode = g.nodes.find(n => n.type === 'data.cluster-count')!;
    const freqNode    = g.nodes.find(n => n.type === 'sound.frequency')!;
    const gainNode    = g.nodes.find(n => n.type === 'sound.gain')!;

    const distToFreq = g.edges.find(e =>
      e.from.nodeId === distNode.id && e.to.nodeId === freqNode.id);
    expect(distToFreq, 'distance→frequency edge missing').toBeDefined();
    expect(distToFreq!.from.portId).toBe('distance');
    expect(distToFreq!.to.portId).toBe('frequency');

    const clusterToGain = g.edges.find(e =>
      e.from.nodeId === clusterNode.id && e.to.nodeId === gainNode.id);
    expect(clusterToGain, 'cluster-count→gain edge missing').toBeDefined();
    expect(clusterToGain!.from.portId).toBe('count');
    expect(clusterToGain!.to.portId).toBe('amp');
  });

  it('skips data→sound wiring if port kinds are incompatible (graceful fallback)', () => {
    registerNodeDef({
      type: 'data.distance-to-sun',
      side: 'data',
      label: 'Distance',
      inputs:  [],
      outputs: [{ id: 'distance', label: 'dist', kind: 'trigger' }],
      defaultParams: {},
      codegen: () => '',
      perTickValue: () => 0,
    });

    const g = _seedDefaultGraphForTests(1);
    expect(g.nodes.map(n => n.type).sort()).toEqual([
      'data.distance-to-sun',
      'sound.frequency',
      'sound.gain',
    ]);
    expect(g.edges).toHaveLength(0);
  });
});

// ── quantizeNote (unchanged logic) ───────────────────────────────────────────

describe('quantizeNote — chromatic mapping', () => {
  it('x=0 maps to the root', () => {
    expect(quantizeNote(0, 'c4', 12)).toBe('c4');
  });

  it('x just under one semitone-slice stays on the root', () => {
    expect(quantizeNote(0.08, 'c4', 12)).toBe('c4');
  });

  it('x past one semitone-slice advances to c#4', () => {
    expect(quantizeNote(0.09, 'c4', 12)).toBe('c#4');
  });

  it('x=0.5 maps to f#4 (6 semitones above c4)', () => {
    expect(quantizeNote(0.5, 'c4', 12)).toBe('f#4');
  });

  it('x near 1 maps to b4 (11 semitones above c4)', () => {
    expect(quantizeNote(0.999, 'c4', 12)).toBe('b4');
  });

  it('x=1.0 clamps — does NOT overflow to c5', () => {
    expect(quantizeNote(1.0, 'c4', 12)).toBe('b4');
  });

  it('x=0.5 with root=a4, span=24 maps to a5 (12 semitones above a4)', () => {
    expect(quantizeNote(0.5, 'a4', 24)).toBe('a5');
  });

  it('x<0 clamps to the root', () => {
    expect(quantizeNote(-0.5, 'g4', 12)).toBe('g4');
  });

  it('handles sharp roots (f#3)', () => {
    expect(quantizeNote(0, 'f#3', 12)).toBe('f#3');
    expect(quantizeNote(0.5, 'f#3', 12)).toBe('c4');
  });

  it('returns c4 on unparseable root strings', () => {
    expect(quantizeNote(0, 'not-a-note', 12)).toBe('c4');
    expect(quantizeNote(0.5, '', 12)).toBe('c4');
  });

  it('falls back to span=12 on invalid span', () => {
    expect(quantizeNote(0.5, 'c4', 0)).toBe('f#4');
    expect(quantizeNote(0.5, 'c4', -4)).toBe('f#4');
    expect(quantizeNote(0.5, 'c4', Number.NaN)).toBe('f#4');
  });
});

describe('installQuantizeHelper', () => {
  it('attaches the quantize fn to globalThis.__sw_quantizeNote', () => {
    installQuantizeHelper();
    const g = globalThis as unknown as Record<string, unknown>;
    expect(typeof g['__sw_quantizeNote']).toBe('function');
    const fn = g['__sw_quantizeNote'] as (x: number, r: string, s: number) => string;
    expect(fn(0.5, 'c4', 12)).toBe('f#4');
  });
});
