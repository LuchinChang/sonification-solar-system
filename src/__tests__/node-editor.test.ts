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
  incomingEdges,
} from '../node-editor';
import { _resetRegistryForTests } from '../node-editor/registry';
import { _resetIdsForTests } from '../node-editor/graph';
import type { NodeDefinition } from '../node-editor';

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
