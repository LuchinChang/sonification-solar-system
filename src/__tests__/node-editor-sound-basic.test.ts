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
    expect(getNodeDef('sound.pitch')!.defaultParams).toEqual({ note: 'c4' });
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

  it('sound.pitch emits .note(signal(...)) when wired', () => {
    registerDataStub();
    const g = createGraph(9);
    const src   = addNode(g, { type: 'data.stub',   side: 'data',  x: 0, y: 0 });
    const pitch = addNode(g, { type: 'sound.pitch', side: 'sound', x: 0, y: 0 });
    const edge: Edge = addEdge(g, {
      from: { nodeId: src.id,   portId: 'noteSig', dir: 'out' },
      to:   { nodeId: pitch.id, portId: 'note',    dir: 'in' },
    });
    const out = getNodeDef('sound.pitch')!.codegen(makeCtx(9, g), pitch.params, [edge]);
    expect(out).toBe('.note(signal(() => globalThis.__sw_9_noteSig))');
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
