// src/__tests__/node-editor-sound-basic.test.ts
//
// Unit 8 — tests for the four sound-side basic NodeDefinitions and the
// default-graph seeding used by panel.ts openEditor().
//
// We intentionally exercise codegen() directly (not through Unit 14's driver)
// so these tests stay local to Unit 8.

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
import type { CodegenCtx, Edge, NodeDefinition, NodeGraph } from '../node-editor';

// Side-effect import is intentionally avoided — registry reset in beforeEach
// wipes it. We call the explicit registrar each time instead.
import { registerSoundBasicNodes } from '../node-editor/nodes/sound-basic';
import { _seedDefaultGraphForTests } from '../node-editor/panel';
import { quantizeNote, installQuantizeHelper } from '../node-editor/codegen-helpers';

// ── CodegenCtx factory ───────────────────────────────────────────────────────

function makeCtx(sweeperId: number, g: NodeGraph): CodegenCtx {
  return {
    sweeperId,
    nodeVar: (nodeId) => `sw_${sweeperId}_${nodeId}`,
    incoming: (nodeId, portId) => incomingEdges(g, nodeId, portId),
    paramsOf: <T = Record<string, unknown>>(nodeId: string) =>
      (g.nodes.find(n => n.id === nodeId)?.params ?? {}) as T,
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
    for (const type of ['sound.pitch', 'sound.frequency-range', 'sound.lpf', 'sound.gain']) {
      const def = getNodeDef(type);
      expect(def, `missing def: ${type}`).toBeDefined();
      expect(def!.side).toBe('sound');
    }
  });

  it('has the expected defaultParams', () => {
    expect(getNodeDef('sound.pitch')!.defaultParams).toEqual({ note: 'c4', root: 'c4', span: 12 });
    expect(getNodeDef('sound.frequency-range')!.defaultParams).toEqual({ min: 100, max: 1000 });
    expect(getNodeDef('sound.lpf')!.defaultParams).toEqual({ frequency: 1200 });
    expect(getNodeDef('sound.gain')!.defaultParams).toEqual({ amp: 0.6 });
  });
});

// ── Codegen: unwired (static param) ──────────────────────────────────────────

describe('sound-basic codegen — unwired (static)', () => {
  it('sound.pitch emits .note(`pattern`)', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.pitch', side: 'sound', x: 0, y: 0, params: { note: 'e4 g4' } });
    const out = getNodeDef('sound.pitch')!.codegen(makeCtx(1, g), n.params, []);
    expect(out).toBe('.note(`e4 g4`)');
  });

  it('sound.pitch falls back to c4 when param is missing/invalid', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.pitch', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.pitch')!.codegen(makeCtx(1, g), n.params, []);
    expect(out).toBe('.note(`c4`)');
  });

  it('sound.frequency-range emits empty string (no chain fragment)', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.frequency-range', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.frequency-range')!.codegen(makeCtx(1, g), n.params, []);
    expect(out).toBe('');
  });

  it('sound.lpf emits .lpf(number) with the default value', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.lpf', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.lpf')!.codegen(makeCtx(1, g), n.params, []);
    expect(out).toBe('.lpf(1200)');
  });

  it('sound.gain emits .gain(number) with the default value', () => {
    const g = createGraph(1);
    const n = addNode(g, { type: 'sound.gain', side: 'sound', x: 0, y: 0 });
    const out = getNodeDef('sound.gain')!.codegen(makeCtx(1, g), n.params, []);
    expect(out).toBe('.gain(0.6)');
  });
});

// ── Codegen: wired (signal ref) ──────────────────────────────────────────────

describe('sound-basic codegen — wired (signal)', () => {
  // Stub a data-side source def exposing both `freq-signal` and `density` outputs.
  function registerDataStub(): void {
    const stub: NodeDefinition = {
      type:  'data.stub',
      side:  'data',
      label: 'Stub',
      inputs:  [],
      outputs: [
        { id: 'distance', label: 'dist',  kind: 'number' },
        { id: 'count',    label: 'count', kind: 'number' },
        { id: 'noteSig',  label: 'note',  kind: 'pattern' },
      ],
      defaultParams: {},
      codegen: () => '',
    };
    registerNodeDef(stub);
  }

  it('sound.lpf emits .lpf(signal(...)) when wired', () => {
    registerDataStub();
    const g = createGraph(7);
    const src = addNode(g, { type: 'data.stub', side: 'data',  x: 0, y: 0 });
    const lpf = addNode(g, { type: 'sound.lpf', side: 'sound', x: 0, y: 0 });
    const edge = addEdge(g, {
      from: { nodeId: src.id, portId: 'distance', dir: 'out' },
      to:   { nodeId: lpf.id, portId: 'frequency', dir: 'in' },
    });
    const out = getNodeDef('sound.lpf')!.codegen(makeCtx(7, g), lpf.params, [edge]);
    expect(out).toBe('.lpf(signal(() => globalThis.__sw_7_distance))');
  });

  it('sound.gain emits .gain(signal(...)) when wired', () => {
    registerDataStub();
    const g = createGraph(3);
    const src  = addNode(g, { type: 'data.stub',  side: 'data',  x: 0, y: 0 });
    const gain = addNode(g, { type: 'sound.gain', side: 'sound', x: 0, y: 0 });
    const edge = addEdge(g, {
      from: { nodeId: src.id,  portId: 'count', dir: 'out' },
      to:   { nodeId: gain.id, portId: 'amp',   dir: 'in' },
    });
    const out = getNodeDef('sound.gain')!.codegen(makeCtx(3, g), gain.params, [edge]);
    expect(out).toBe('.gain(signal(() => globalThis.__sw_3_count))');
  });

  it('sound.pitch wraps the wired signal with __sw_quantizeNote()', () => {
    registerDataStub();
    const g = createGraph(9);
    const src   = addNode(g, { type: 'data.stub',   side: 'data',  x: 0, y: 0 });
    const pitch = addNode(g, { type: 'sound.pitch', side: 'sound', x: 0, y: 0 });
    const edge: Edge = addEdge(g, {
      from: { nodeId: src.id,   portId: 'noteSig', dir: 'out' },
      to:   { nodeId: pitch.id, portId: 'note',    dir: 'in' },
    });
    const out = getNodeDef('sound.pitch')!.codegen(makeCtx(9, g), pitch.params, [edge]);
    expect(out).toBe(
      '.note(signal(() => globalThis.__sw_quantizeNote(globalThis.__sw_9_noteSig, "c4", 12)))'
    );
  });

  it('sound.pitch honours custom root/span params when wired', () => {
    registerDataStub();
    const g = createGraph(2);
    const src   = addNode(g, { type: 'data.stub', side: 'data',  x: 0, y: 0 });
    const pitch = addNode(g, {
      type: 'sound.pitch', side: 'sound', x: 0, y: 0,
      params: { note: 'c4', root: 'a4', span: 24 },
    });
    const edge = addEdge(g, {
      from: { nodeId: src.id,   portId: 'noteSig', dir: 'out' },
      to:   { nodeId: pitch.id, portId: 'note',    dir: 'in' },
    });
    const out = getNodeDef('sound.pitch')!.codegen(makeCtx(2, g), pitch.params, [edge]);
    expect(out).toBe(
      '.note(signal(() => globalThis.__sw_quantizeNote(globalThis.__sw_2_noteSig, "a4", 24)))'
    );
  });
});

// ── Default graph seeding ────────────────────────────────────────────────────

describe('default graph seeding (openEditor)', () => {
  // Unit 6's data nodes aren't registered in this suite — the seeder MUST
  // fall back gracefully to just the two sound nodes.
  it('falls back to sound-only when Unit 6 data nodes are absent', () => {
    const g = _seedDefaultGraphForTests(123);
    expect(g.sweeperId).toBe(123);
    const types = g.nodes.map(n => n.type).sort();
    expect(types).toEqual(['sound.gain', 'sound.lpf']);
    expect(g.edges).toHaveLength(0);
  });

  it('seeds full default graph when Unit 6 data nodes ARE registered', () => {
    // Register stand-ins for the Unit 6 defs the seeder looks up.
    registerNodeDef({
      type: 'data.distance-to-sun',
      side: 'data',
      label: 'Distance to Sun',
      inputs:  [],
      outputs: [{ id: 'distance', label: 'dist', kind: 'number' }],
      defaultParams: {},
      codegen: () => '',
    });
    registerNodeDef({
      type: 'data.cluster-count',
      side: 'data',
      label: 'Cluster Count',
      inputs:  [],
      outputs: [{ id: 'count', label: 'count', kind: 'number' }],
      defaultParams: {},
      codegen: () => '',
    });

    const g = _seedDefaultGraphForTests(42);

    const types = g.nodes.map(n => n.type).sort();
    expect(types).toEqual([
      'data.cluster-count',
      'data.distance-to-sun',
      'sound.gain',
      'sound.lpf',
    ]);
    expect(g.edges).toHaveLength(2);

    // Verify the two edges: distance→lpf.frequency and cluster-count→gain.amp
    const distNode    = g.nodes.find(n => n.type === 'data.distance-to-sun')!;
    const clusterNode = g.nodes.find(n => n.type === 'data.cluster-count')!;
    const lpfNode     = g.nodes.find(n => n.type === 'sound.lpf')!;
    const gainNode    = g.nodes.find(n => n.type === 'sound.gain')!;

    const distToLpf = g.edges.find(e =>
      e.from.nodeId === distNode.id && e.to.nodeId === lpfNode.id);
    expect(distToLpf, 'distance→lpf edge missing').toBeDefined();
    expect(distToLpf!.from.portId).toBe('distance');
    expect(distToLpf!.to.portId).toBe('frequency');

    const clusterToGain = g.edges.find(e =>
      e.from.nodeId === clusterNode.id && e.to.nodeId === gainNode.id);
    expect(clusterToGain, 'cluster-count→gain edge missing').toBeDefined();
    expect(clusterToGain!.from.portId).toBe('count');
    expect(clusterToGain!.to.portId).toBe('amp');
  });

  it('skips data→sound wiring if port kinds are incompatible (graceful fallback)', () => {
    // Register a data.distance-to-sun with a trigger port — incompatible with
    // sound.lpf's number input. Seeder should still produce sound nodes.
    registerNodeDef({
      type: 'data.distance-to-sun',
      side: 'data',
      label: 'Distance',
      inputs:  [],
      outputs: [{ id: 'distance', label: 'dist', kind: 'trigger' }],
      defaultParams: {},
      codegen: () => '',
    });

    const g = _seedDefaultGraphForTests(1);
    // Data node is instantiated, but the incompatible edge is dropped.
    expect(g.nodes.map(n => n.type).sort()).toEqual([
      'data.distance-to-sun',
      'sound.gain',
      'sound.lpf',
    ]);
    expect(g.edges).toHaveLength(0);
  });
});

// ── Pitch chromatic quantization (Unit 4) ────────────────────────────────────

describe('quantizeNote — chromatic mapping', () => {
  it('x=0 maps to the root', () => {
    expect(quantizeNote(0, 'c4', 12)).toBe('c4');
  });

  it('x just under one semitone-slice stays on the root', () => {
    // 1/12 ≈ 0.0833, so 0.08 floors to semi 0 → still c4
    expect(quantizeNote(0.08, 'c4', 12)).toBe('c4');
  });

  it('x past one semitone-slice advances to c#4', () => {
    // 0.09 * 12 = 1.08 → floor 1 → c#4
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
    // 0.5 * 24 = 12 → a4 + 12 semitones = a5
    expect(quantizeNote(0.5, 'a4', 24)).toBe('a5');
  });

  it('x<0 clamps to the root', () => {
    expect(quantizeNote(-0.5, 'g4', 12)).toBe('g4');
  });

  it('handles sharp roots (f#3)', () => {
    expect(quantizeNote(0, 'f#3', 12)).toBe('f#3');
    expect(quantizeNote(0.5, 'f#3', 12)).toBe('c4'); // 6 semitones above f#3
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
