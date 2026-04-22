// @vitest-environment jsdom
//
// src/__tests__/node-editor-cables.test.ts
//
// Unit 11: cable drag + connect interactions.
//
// Runs under jsdom (per-file opt-in via the magic comment above) so we can
// construct real Element + SVGSVGElement instances, dispatch PointerEvents,
// and assert on the resulting graph mutations + DOM state.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerNodeDef,
  listNodeDefs,
  createGraph,
} from '../node-editor';
import { _resetRegistryForTests } from '../node-editor/registry';
import { _resetIdsForTests } from '../node-editor/graph';
import {
  initCables,
  pathForEndpoints,
  GRAPH_CHANGED_EVENT,
} from '../node-editor/cables';
import type { NodeDefinition, NodeGraph } from '../node-editor';

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

/** Build a minimal in-document panel + SVG + two ports (out, in). */
function setupHarness(): {
  root: HTMLDivElement;
  svg:  SVGSVGElement;
  outPort: HTMLElement;
  inPort:  HTMLElement;
  dispose: () => void;
} {
  const root = document.createElement('div');
  root.id = 'harness-panel';
  document.body.appendChild(root);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.appendChild(svg);

  const outPort = document.createElement('div');
  outPort.className = 'port out';
  outPort.setAttribute('data-node-id', 'nSrc');
  outPort.setAttribute('data-port-id', 'out');
  outPort.setAttribute('data-direction', 'out');
  outPort.setAttribute('data-kind', 'signal');
  root.appendChild(outPort);

  const inPort = document.createElement('div');
  inPort.className = 'port in';
  inPort.setAttribute('data-node-id', 'nSink');
  inPort.setAttribute('data-port-id', 'in');
  inPort.setAttribute('data-direction', 'in');
  inPort.setAttribute('data-kind', 'signal');
  root.appendChild(inPort);

  // jsdom returns zero-sized rects; stub them deterministically.
  const mkRect = (x: number, y: number, w = 10, h = 10): DOMRect => ({
    x, y, width: w, height: h,
    left: x, top: y, right: x + w, bottom: y + h,
    toJSON: () => ({}),
  });
  vi.spyOn(svg,     'getBoundingClientRect').mockReturnValue(mkRect(0, 0, 400, 300));
  vi.spyOn(outPort, 'getBoundingClientRect').mockReturnValue(mkRect(10, 100));
  vi.spyOn(inPort,  'getBoundingClientRect').mockReturnValue(mkRect(300, 100));

  const dispose = () => {
    root.remove();
  };
  return { root, svg, outPort, inPort, dispose };
}

/** Dispatch a PointerEvent-shaped event on a target. jsdom PointerEvent may
 *  be missing, so fall back to MouseEvent with type forced to "pointer…" —
 *  our code listens generically and only reads clientX / clientY / target. */
function firePointer(target: EventTarget, type: string, init: { clientX?: number; clientY?: number } = {}): Event {
  const EvtCtor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const ev = new EvtCtor(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

let graph: NodeGraph;
let cleanup: (() => void) | null = null;

beforeEach(() => {
  _resetRegistryForTests();
  _resetIdsForTests();

  // Two-node test topology: src (signal out) → sink (signal in).
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
  registerNodeDef(makeDef({
    type:   'sound.trig',
    side:   'sound',
    inputs: [{ id: 'in', label: 'in', kind: 'trigger' }],
  }));

  graph = createGraph(1);
  // Pre-seed nodes so the ids match data-node-id on our harness ports.
  graph.nodes.push(
    { id: 'nSrc',  type: 'data.src',    side: 'data',  x: 0, y: 0, params: {} },
    { id: 'nSink', type: 'sound.sink',  side: 'sound', x: 0, y: 0, params: {} },
    { id: 'nTrig', type: 'sound.trig',  side: 'sound', x: 0, y: 0, params: {} },
  );
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// ── Geometry ─────────────────────────────────────────────────────────────────

describe('pathForEndpoints', () => {
  it('produces a straight M … L … path', () => {
    const d = pathForEndpoints(0, 0, 100, 0);
    expect(d).toBe('M 0.00 0.00 L 100.00 0.00');
  });

  it('handles degenerate and long segments without curvature', () => {
    // Zero-length: collapses to a point but still produces a valid path.
    const dZero = pathForEndpoints(50, 50, 50, 50);
    expect(dZero).toBe('M 50.00 50.00 L 50.00 50.00');
    // Very long: endpoints preserved exactly, no Bézier control terms.
    const dLong = pathForEndpoints(0, 0, 10000, 0);
    expect(dLong).toBe('M 0.00 0.00 L 10000.00 0.00');
    expect(dLong).not.toContain('Q');
  });
});

// ── Registry sanity (makes sure our test fixtures are live) ─────────────────

describe('cables harness sanity', () => {
  it('registers three test defs', () => {
    expect(listNodeDefs()).toHaveLength(3);
  });
});

// ── Drag → commit flow ───────────────────────────────────────────────────────

describe('cable drag + connect', () => {
  it('commits an edge + dispatches graphChanged on compatible drop', () => {
    const { root, svg, outPort, inPort } = setupHarness();
    cleanup = initCables(root, svg, { getGraph: () => graph });

    const onChange = vi.fn();
    root.addEventListener(GRAPH_CHANGED_EVENT, onChange);

    firePointer(outPort, 'pointerdown', { clientX: 15, clientY: 105 });
    firePointer(root,    'pointermove', { clientX: 200, clientY: 105 });
    firePointer(inPort,  'pointerover', { clientX: 300, clientY: 105 });
    expect(inPort.classList.contains('valid-target')).toBe(true);

    firePointer(inPort,  'pointerup', { clientX: 305, clientY: 105 });

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toMatchObject({ nodeId: 'nSrc',  portId: 'out', dir: 'out' });
    expect(graph.edges[0].to  ).toMatchObject({ nodeId: 'nSink', portId: 'in',  dir: 'in' });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Preview path gone; a persistent .edge path now lives in #edges.
    expect(svg.querySelectorAll('.edge-preview').length).toBe(0);
    const edges = svg.querySelectorAll('#edges .edge');
    expect(edges.length).toBe(1);
    expect(edges[0].getAttribute('data-edge-id')).toBe(graph.edges[0].id);
  });

  it('rejects incompatible connections (no highlight, no commit)', () => {
    const { root, svg, outPort } = setupHarness();

    // Add a trigger-in port that's incompatible with signal out.
    const trigPort = document.createElement('div');
    trigPort.className = 'port in';
    trigPort.setAttribute('data-node-id', 'nTrig');
    trigPort.setAttribute('data-port-id', 'in');
    trigPort.setAttribute('data-direction', 'in');
    trigPort.setAttribute('data-kind', 'trigger');
    root.appendChild(trigPort);
    vi.spyOn(trigPort, 'getBoundingClientRect').mockReturnValue({
      x: 300, y: 200, width: 10, height: 10,
      left: 300, top: 200, right: 310, bottom: 210,
      toJSON: () => ({}),
    } as DOMRect);

    cleanup = initCables(root, svg, { getGraph: () => graph });

    const onChange = vi.fn();
    root.addEventListener(GRAPH_CHANGED_EVENT, onChange);

    firePointer(outPort,  'pointerdown', { clientX: 15, clientY: 105 });
    firePointer(trigPort, 'pointerover', { clientX: 305, clientY: 205 });

    expect(trigPort.classList.contains('valid-target')).toBe(false);

    firePointer(trigPort, 'pointerup', { clientX: 305, clientY: 205 });

    expect(graph.edges).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cancels the drag on pointerup over empty space', () => {
    const { root, svg, outPort } = setupHarness();
    cleanup = initCables(root, svg, { getGraph: () => graph });

    firePointer(outPort, 'pointerdown', { clientX: 15, clientY: 105 });
    expect(svg.querySelectorAll('.edge-preview').length).toBe(1);

    // pointerup on the panel root (not on any port)
    firePointer(root, 'pointerup', { clientX: 50, clientY: 50 });

    expect(svg.querySelectorAll('.edge-preview').length).toBe(0);
    expect(graph.edges).toHaveLength(0);
  });

  // Bug 2 regression: pre-existing edges (hydrated from a snapshot or seeded
  // by the default-graph logic) must materialize SVG paths when a
  // `graphChanged` fires — otherwise the user opens the panel and sees
  // disconnected chips even though the underlying graph is fully wired.
  it('materializes edges that are already in the graph when graphChanged fires', () => {
    const { root, svg, outPort, inPort } = setupHarness();

    // Seed the graph with an edge BEFORE initCables / before any drag.
    // This mimics panel.ts hydrating shape.graph or calling seedDefaultGraph.
    graph.edges.push({
      id:   'preseeded-1',
      from: { nodeId: 'nSrc',  portId: 'out', dir: 'out' },
      to:   { nodeId: 'nSink', portId: 'in',  dir: 'in'  },
    });

    cleanup = initCables(root, svg, { getGraph: () => graph });

    // No path yet — onGraphChanged reconciles synchronously when fired.
    expect(svg.querySelectorAll('#edges .edge').length).toBe(0);

    root.dispatchEvent(new CustomEvent(GRAPH_CHANGED_EVENT, { bubbles: true }));

    const edges = svg.querySelectorAll('#edges .edge');
    expect(edges.length).toBe(1);
    expect(edges[0].getAttribute('data-edge-id')).toBe('preseeded-1');

    // Ports were mocked with getBoundingClientRect so the path picked up a
    // real `d`. Sanity: the path endpoints should reflect those anchors.
    expect(edges[0].getAttribute('d')).toMatch(/^M\s/);

    // Silence the unused lint on outPort / inPort — they're used by the
    // setupHarness mocks that the anchor calculation pulls from.
    void outPort; void inPort;
  });

  it('selects an edge on click and deletes it on Backspace', () => {
    const { root, svg, outPort, inPort } = setupHarness();
    cleanup = initCables(root, svg, { getGraph: () => graph });

    // Commit one edge.
    firePointer(outPort, 'pointerdown', { clientX: 15, clientY: 105 });
    firePointer(inPort,  'pointerover', { clientX: 305, clientY: 105 });
    firePointer(inPort,  'pointerup',   { clientX: 305, clientY: 105 });
    expect(graph.edges).toHaveLength(1);

    const edgePath = svg.querySelector('#edges .edge') as SVGPathElement;
    expect(edgePath).not.toBeNull();

    // Click to select.
    edgePath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(edgePath.classList.contains('selected')).toBe(true);

    // Backspace removes it.
    const onChange = vi.fn();
    root.addEventListener(GRAPH_CHANGED_EVENT, onChange);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));

    expect(graph.edges).toHaveLength(0);
    expect(svg.querySelectorAll('#edges .edge').length).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
