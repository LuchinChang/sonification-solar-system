// src/__tests__/node-editor.test.ts
//
// Unit 4: scaffolding tests for the node-editor module.
//
// Two minimum-viable tests per the unit spec:
//   1. registry round-trip:  register → getNodeDef → listNodeDefs(side).
//   2. graph integrity:      addNode → addEdge → removeEdge, plus cycle guard.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerNodeDef,
  getNodeDef,
  listNodeDefs,
  createGraph,
  addNode,
  addEdge,
  removeEdge,
  removeNode,
  incomingEdges,
  graphFromSnapshot,
  initNodeEditor,
  openEditor,
  closeEditor,
  isEditorOpen,
  currentSweeperId,
} from '../node-editor';
import { _resetRegistryForTests } from '../node-editor/registry';
import { _resetIdsForTests } from '../node-editor/graph';
import { _seedDefaultGraphForTests } from '../node-editor/panel';
import type { NodeDefinition, NodeGraph } from '../node-editor';
import type { NodeGraphSnapshot } from '../config-snapshot';
import type { CanvasShape } from '../shapes';

// Minimal DOM stub — the panel builds its shell lazily via ensureMounted().
// We don't exercise any visual behaviour here, only the toggle logic, so a
// pass-through stub is enough. tour.test.ts follows the same pattern.
if (typeof document === 'undefined') {
  function makeEl(): Record<string, unknown> {
    const classes = new Set<string>();
    const el: Record<string, unknown> = {
      id: '',
      className: '',
      textContent: '',
      innerHTML: '',
      style: {} as Record<string, string>,
      classList: {
        add:    (c: string) => { classes.add(c); },
        remove: (c: string) => { classes.delete(c); },
        toggle: (c: string) => { classes.has(c) ? classes.delete(c) : classes.add(c); },
        contains: (c: string) => classes.has(c),
      },
      setAttribute: () => {},
      removeAttribute: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      append: () => {},
      appendChild: () => {},
      querySelector:   () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
    };
    return el;
  }
  (globalThis as Record<string, unknown>).document = {
    body: makeEl(),
    createElement: () => makeEl(),
    createElementNS: () => makeEl(),
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDef(partial: Partial<NodeDefinition> & Pick<NodeDefinition, 'type' | 'side'>): NodeDefinition {
  return {
    label: partial.label ?? partial.type,
    inputs: partial.inputs ?? [],
    outputs: partial.outputs ?? [],
    defaultParams: partial.defaultParams ?? {},
    codegen: partial.codegen ?? (() => ''),
    ...partial,
  };
}

beforeEach(() => {
  _resetRegistryForTests();
  _resetIdsForTests();
});

// ── Registry ─────────────────────────────────────────────────────────────────

describe('node-editor registry', () => {
  it('registers and retrieves a definition by type', () => {
    const def = makeDef({ type: 'data.distance-to-sun', side: 'data', label: 'Distance' });
    registerNodeDef(def);
    expect(getNodeDef('data.distance-to-sun')).toBe(def);
  });

  it('filters listNodeDefs by side', () => {
    registerNodeDef(makeDef({ type: 'data.a', side: 'data' }));
    registerNodeDef(makeDef({ type: 'sound.a', side: 'sound' }));
    registerNodeDef(makeDef({ type: 'sound.b', side: 'sound' }));

    expect(listNodeDefs('data')).toHaveLength(1);
    expect(listNodeDefs('sound')).toHaveLength(2);
    expect(listNodeDefs()).toHaveLength(3);
  });

  it('throws on duplicate type registration', () => {
    registerNodeDef(makeDef({ type: 'dup', side: 'data' }));
    expect(() => registerNodeDef(makeDef({ type: 'dup', side: 'data' }))).toThrow(/duplicate/);
  });
});

// ── Graph ────────────────────────────────────────────────────────────────────

describe('node-editor graph', () => {
  it('addNode → addEdge → removeEdge round-trip preserves integrity', () => {
    registerNodeDef(makeDef({
      type:    'data.src',
      side:    'data',
      outputs: [{ id: 'out', label: 'out', kind: 'signal' }],
    }));
    registerNodeDef(makeDef({
      type:   'sound.sink',
      side:   'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'signal' }],
    }));

    const g = createGraph(42);
    const src  = addNode(g, { type: 'data.src',  side: 'data',  x: 0, y: 0 });
    const sink = addNode(g, { type: 'sound.sink', side: 'sound', x: 0, y: 0 });

    const edge = addEdge(g, {
      from: { nodeId: src.id,  portId: 'out', dir: 'out' },
      to:   { nodeId: sink.id, portId: 'in',  dir: 'in' },
    });

    expect(g.edges).toHaveLength(1);
    expect(incomingEdges(g, sink.id, 'in')).toEqual([edge]);

    expect(removeEdge(g, edge.id)).toBe(true);
    expect(g.edges).toHaveLength(0);
    expect(removeEdge(g, edge.id)).toBe(false);
  });

  it('removeNode cascades to incident edges', () => {
    registerNodeDef(makeDef({
      type:    'data.src',
      side:    'data',
      outputs: [{ id: 'out', label: 'out', kind: 'signal' }],
    }));
    registerNodeDef(makeDef({
      type:    'sound.mid',
      side:    'sound',
      inputs:  [{ id: 'in',  label: 'in',  kind: 'signal' }],
      outputs: [{ id: 'out', label: 'out', kind: 'signal' }],
    }));
    registerNodeDef(makeDef({
      type:   'sound.sink',
      side:   'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'signal' }],
    }));

    const g = createGraph(1);
    const src  = addNode(g, { type: 'data.src',   side: 'data',  x: 0, y: 0 });
    const mid  = addNode(g, { type: 'sound.mid',  side: 'sound', x: 0, y: 0 });
    const sink = addNode(g, { type: 'sound.sink', side: 'sound', x: 0, y: 0 });

    addEdge(g, { from: { nodeId: src.id, portId: 'out', dir: 'out' }, to: { nodeId: mid.id,  portId: 'in', dir: 'in' } });
    addEdge(g, { from: { nodeId: mid.id, portId: 'out', dir: 'out' }, to: { nodeId: sink.id, portId: 'in', dir: 'in' } });
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);

    // Remove the middle node — both incident edges must be dropped.
    expect(removeNode(g, mid.id)).toBe(true);
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes.some(n => n.id === mid.id)).toBe(false);
    expect(g.edges).toHaveLength(0);

    // Unknown id is a no-op.
    expect(removeNode(g, 'never-existed')).toBe(false);

    // Surviving (unrelated) nodes / edges are untouched.
    const src2 = addNode(g, { type: 'data.src',   side: 'data',  x: 0, y: 0 });
    const sink2 = addNode(g, { type: 'sound.sink', side: 'sound', x: 0, y: 0 });
    const keep = addEdge(g, { from: { nodeId: src2.id, portId: 'out', dir: 'out' }, to: { nodeId: sink2.id, portId: 'in', dir: 'in' } });
    expect(removeNode(g, src.id)).toBe(true); // src had no edges left
    expect(g.edges).toContain(keep);
  });

  it('rejects incompatible port kinds', () => {
    registerNodeDef(makeDef({
      type:    'a',
      side:    'data',
      outputs: [{ id: 'out', label: 'out', kind: 'signal' }],
    }));
    registerNodeDef(makeDef({
      type:   'b',
      side:   'sound',
      inputs: [{ id: 'in', label: 'in', kind: 'trigger' }],
    }));

    const g = createGraph(1);
    const a = addNode(g, { type: 'a', side: 'data',  x: 0, y: 0 });
    const b = addNode(g, { type: 'b', side: 'sound', x: 0, y: 0 });

    expect(() => addEdge(g, {
      from: { nodeId: a.id, portId: 'out', dir: 'out' },
      to:   { nodeId: b.id, portId: 'in',  dir: 'in' },
    })).toThrow(/incompatible/);
  });

  it('openEditor is a toggle for the same sweeper id', () => {
    // Minimal sweeper stub — only .type, .id, .sweepColor are read by the panel.
    const fakeSweeper = { id: 7, type: 'sweeper', sweepColor: '#C084FC', graph: null, toStrudelCode: () => '// @shape-start-7\n// @shape-end-7' } as unknown as CanvasShape;
    initNodeEditor({ resolveSweeper: id => (id === 7 ? fakeSweeper : null) });

    // Starts closed.
    if (isEditorOpen()) closeEditor();
    expect(isEditorOpen()).toBe(false);

    openEditor(7);
    expect(isEditorOpen()).toBe(true);
    expect(currentSweeperId()).toBe(7);

    // Same id again → toggle closes.
    openEditor(7);
    expect(isEditorOpen()).toBe(false);
    expect(currentSweeperId()).toBeNull();
  });

  it('openEditor repoints when called for a different sweeper', () => {
    const sweepers: Record<number, CanvasShape> = {
      7: { id: 7, type: 'sweeper', sweepColor: '#C084FC', graph: null, toStrudelCode: () => '// @shape-start-7\n// @shape-end-7' } as unknown as CanvasShape,
      9: { id: 9, type: 'sweeper', sweepColor: '#E8A050', graph: null, toStrudelCode: () => '// @shape-start-9\n// @shape-end-9' } as unknown as CanvasShape,
    };
    initNodeEditor({ resolveSweeper: id => sweepers[id] ?? null });

    if (isEditorOpen()) closeEditor();
    openEditor(7);
    expect(currentSweeperId()).toBe(7);

    openEditor(9);
    expect(isEditorOpen()).toBe(true);
    expect(currentSweeperId()).toBe(9);

    closeEditor();
  });

  it('round-trips through graphToSnapshot / graphFromSnapshot preserving ids, positions and counter', () => {
    // Must register the data + sound defs the seed function wires together,
    // otherwise seedDefaultGraph yields an empty graph and the test is a no-op.
    registerNodeDef({
      type: 'data.distance-to-sun',
      side: 'data',
      label: 'Distance',
      outputs: [{ id: 'distance', label: 'distance', kind: 'number' }],
      codegen: () => '',
    });
    registerNodeDef({
      type: 'data.cluster-count',
      side: 'data',
      label: 'Count',
      outputs: [{ id: 'count', label: 'count', kind: 'number' }],
      codegen: () => '',
    });
    registerNodeDef({
      type: 'sound.lpf',
      side: 'sound',
      label: 'LPF',
      inputs: [{ id: 'frequency', label: 'frequency', kind: 'number' }],
      codegen: () => '',
    });
    registerNodeDef({
      type: 'sound.gain',
      side: 'sound',
      label: 'Gain',
      inputs: [{ id: 'amp', label: 'amp', kind: 'number' }],
      codegen: () => '',
    });

    // (1) seed + (2) mutate by adding one node at a known position.
    const g = _seedDefaultGraphForTests(7);
    const nodeCountBefore = g.nodes.length;
    const edgeCountBefore = g.edges.length;
    const added = addNode(g, {
      type: 'data.cluster-count', side: 'data', x: 48, y: 72,
    });
    expect(g.nodes).toHaveLength(nodeCountBefore + 1);

    // (3) Serialise — inline the same logic as panel.ts's graphToSnapshot so
    //     the test doesn't depend on private exports.
    const snapshot: NodeGraphSnapshot = {
      nodes: g.nodes.map(n => ({
        id: n.id, defType: n.type, x: n.x, y: n.y, params: { ...n.params },
      })),
      edges: g.edges.map(e => ({
        id: e.id,
        fromPort: `${e.from.nodeId}:${e.from.portId}`,
        toPort:   `${e.to.nodeId}:${e.to.portId}`,
      })),
    };

    // Record the largest numeric id the snapshot carries.
    const maxNodeNum = Math.max(0, ...snapshot.nodes.map(n => Number(n.id.slice(1)) || 0));

    // (4) Deserialise — fresh id counters, then hydrate.
    _resetIdsForTests();
    const restored: NodeGraph = graphFromSnapshot(snapshot);

    // (5) Assertions.
    expect(restored.nodes).toHaveLength(g.nodes.length);
    expect(restored.edges).toHaveLength(edgeCountBefore);

    const addedRestored = restored.nodes.find(n => n.id === added.id);
    expect(addedRestored).toBeDefined();
    expect(addedRestored!.x).toBe(48);
    expect(addedRestored!.y).toBe(72);

    // Ids should be byte-identical — we round-tripped without minting new ones.
    expect(restored.nodes.map(n => n.id).sort()).toEqual(g.nodes.map(n => n.id).sort());
    expect(restored.edges.map(e => e.id).sort()).toEqual(g.edges.map(e => e.id).sort());

    // Counter advanced past the max id: the very next addNode must produce
    // an id numerically larger than any id in the snapshot.
    const freshNode = addNode(restored, {
      type: 'data.cluster-count', side: 'data', x: 0, y: 0,
    });
    const freshNum = Number(freshNode.id.slice(1));
    expect(freshNum).toBeGreaterThan(maxNodeNum);
  });

  it('rejects edges that would create a cycle', () => {
    registerNodeDef(makeDef({
      type:    'node',
      side:    'data',
      inputs:  [{ id: 'in',  label: 'in',  kind: 'any' }],
      outputs: [{ id: 'out', label: 'out', kind: 'any' }],
    }));

    const g = createGraph(1);
    const a = addNode(g, { type: 'node', side: 'data', x: 0, y: 0 });
    const b = addNode(g, { type: 'node', side: 'data', x: 0, y: 0 });

    addEdge(g, {
      from: { nodeId: a.id, portId: 'out', dir: 'out' },
      to:   { nodeId: b.id, portId: 'in',  dir: 'in' },
    });
    expect(() => addEdge(g, {
      from: { nodeId: b.id, portId: 'out', dir: 'out' },
      to:   { nodeId: a.id, portId: 'in',  dir: 'in' },
    })).toThrow(/cycle/);
  });
});
