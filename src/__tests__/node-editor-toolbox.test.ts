// src/__tests__/node-editor-toolbox.test.ts
//
// Unit 13 tests for the toolbox drawer:
//   1. Chips enumerate every registered NodeDefinition, grouped by side.
//   2. A matching drop creates a node via graph.addNode.
//   3. A drop outside any valid zone is rejected (no node added, no onGraphChanged).
//
// No jsdom dependency — we stand up the thinnest possible DOM mock so the
// module's HTMLElement / HTMLButton usage type-checks and behaves at runtime.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  columnForSide,
  groupDefsBySide,
  isDropAccepted,
  mountToolbox,
  resolveDropZone,
  SIDE_ORDER,
  type ToolboxHost,
  type ZoneRect,
} from '../node-editor/toolbox';
import {
  registerNodeDef,
  _resetRegistryForTests,
} from '../node-editor/registry';
import { _resetIdsForTests, createGraph } from '../node-editor/graph';
import type { NodeDefinition, NodeGraph } from '../node-editor';

// ── Pure-function helpers don't need a DOM ──────────────────────────────────

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

// ── Pure helpers ────────────────────────────────────────────────────────────

describe('toolbox pure helpers', () => {
  it('columnForSide maps each side to the correct editor column', () => {
    expect(columnForSide('data')).toBe('left');
    expect(columnForSide('sound')).toBe('right');
    expect(columnForSide('sweeper')).toBe('center');
    expect(columnForSide('playback')).toBe('center');
  });

  it('groupDefsBySide buckets defs by side and preserves registration order', () => {
    const a = makeDef({ type: 'data.a', side: 'data' });
    const b = makeDef({ type: 'sound.a', side: 'sound' });
    const c = makeDef({ type: 'data.b', side: 'data' });
    const grouped = groupDefsBySide([a, b, c]);
    expect(grouped.data.map(d => d.type)).toEqual(['data.a', 'data.b']);
    expect(grouped.sound.map(d => d.type)).toEqual(['sound.a']);
    expect(grouped.sweeper).toEqual([]);
    expect(grouped.playback).toEqual([]);
  });

  it('SIDE_ORDER covers every NodeSide exactly once', () => {
    expect([...SIDE_ORDER].sort()).toEqual(['data', 'playback', 'sound', 'sweeper']);
  });

  it('resolveDropZone returns the column containing (x,y) or null', () => {
    const zones: ZoneRect[] = [
      { column: 'left',   left: 0,   top: 0, right: 100, bottom: 200 },
      { column: 'center', left: 100, top: 0, right: 300, bottom: 200 },
      { column: 'right',  left: 300, top: 0, right: 400, bottom: 200 },
    ];
    expect(resolveDropZone(zones, 50, 100)).toBe('left');
    expect(resolveDropZone(zones, 200, 100)).toBe('center');
    expect(resolveDropZone(zones, 350, 100)).toBe('right');
    expect(resolveDropZone(zones, 500, 100)).toBeNull();
    expect(resolveDropZone(zones, 50, 500)).toBeNull();
  });

  it('isDropAccepted only approves drops whose zone matches the def side', () => {
    const zones: ZoneRect[] = [
      { column: 'left',   left: 0,   top: 0, right: 100, bottom: 200 },
      { column: 'right',  left: 100, top: 0, right: 200, bottom: 200 },
    ];
    expect(isDropAccepted(zones, 'data',  50,  50)).toBe(true);
    expect(isDropAccepted(zones, 'data',  150, 50)).toBe(false); // right zone, wrong side
    expect(isDropAccepted(zones, 'sound', 150, 50)).toBe(true);
    expect(isDropAccepted(zones, 'data',  999, 50)).toBe(false); // no zone
  });
});

// ── DOM-backed tests: stand up a minimal document via a shim ────────────────

/**
 * Install a lightweight DOM polyfill so toolbox.ts can createElement + attach
 * listeners. We avoid pulling jsdom in — the surface we exercise is small.
 */
function installDomShim(): {
  root:     HTMLElement;
  leftCol:  HTMLElement;
  center:   HTMLElement;
  rightCol: HTMLElement;
  firePointerDown: (target: HTMLElement, clientX: number, clientY: number) => void;
  firePointerUp:   (clientX: number, clientY: number) => void;
  firePointerMove: (clientX: number, clientY: number) => void;
  allChips:        () => HTMLElement[];
} {
  class FakeClassList {
    private set = new Set<string>();
    constructor(initial?: string) {
      if (initial) initial.split(/\s+/).filter(Boolean).forEach(c => this.set.add(c));
    }
    add(...cs: string[]):    void    { cs.forEach(c => this.set.add(c)); }
    remove(...cs: string[]): void    { cs.forEach(c => this.set.delete(c)); }
    contains(c: string):     boolean { return this.set.has(c); }
    toggle(c: string, on?: boolean): void {
      const shouldBe = on === undefined ? !this.set.has(c) : on;
      if (shouldBe) this.set.add(c); else this.set.delete(c);
    }
    get value(): string { return [...this.set].join(' '); }
  }

  type AnyListener = (ev: unknown) => void;

  class FakeElement {
    tagName:       string;
    children:      FakeElement[] = [];
    parent:        FakeElement | null = null;
    textContent   = '';
    classList:     FakeClassList;
    dataset:       Record<string, string> = {};
    attrs:         Record<string, string> = {};
    listeners:     Map<string, AnyListener[]> = new Map();
    style:         Record<string, string> = {};
    type           = '';
    offsetWidth   = 1;
    rect:          { left: number; top: number; right: number; bottom: number } = { left: 0, top: 0, right: 0, bottom: 0 };
    constructor(tag: string) { this.tagName = tag.toUpperCase(); this.classList = new FakeClassList(); }

    get className(): string { return this.classList.value; }
    set className(v: string) { this.classList = new FakeClassList(v); }

    setAttribute(k: string, v: string): void { this.attrs[k] = v; }
    getAttribute(k: string): string | null   { return this.attrs[k] ?? null; }
    removeAttribute(k: string): void         { delete this.attrs[k]; }

    appendChild<T extends FakeElement>(child: T): T { child.parent = this; this.children.push(child); return child; }
    append(...kids: FakeElement[]): void { kids.forEach(k => this.appendChild(k)); }
    replaceChildren(...kids: FakeElement[]): void {
      this.children.forEach(c => { c.parent = null; });
      this.children = [];
      kids.forEach(k => this.appendChild(k));
    }
    remove(): void {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter(c => c !== this);
      this.parent = null;
    }

    addEventListener(name: string, cb: AnyListener): void {
      const list = this.listeners.get(name) ?? [];
      list.push(cb);
      this.listeners.set(name, list);
    }
    removeEventListener(name: string, cb: AnyListener): void {
      const list = this.listeners.get(name);
      if (!list) return;
      this.listeners.set(name, list.filter(l => l !== cb));
    }
    dispatchEvent(evt: { type: string } & Record<string, unknown>): boolean {
      const list = this.listeners.get(evt.type);
      list?.forEach(cb => cb(evt));
      return true;
    }

    getBoundingClientRect(): DOMRect {
      const { left, top, right, bottom } = this.rect;
      return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
    }

    querySelector(sel: string): FakeElement | null {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const stack: FakeElement[] = [...this.children];
        while (stack.length) {
          const c = stack.shift()!;
          if (c.classList.contains(cls)) return c;
          stack.unshift(...c.children);
        }
      }
      return null;
    }

    querySelectorAll(sel: string): FakeElement[] {
      const out: FakeElement[] = [];
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const walk = (el: FakeElement): void => {
          if (el.classList.contains(cls)) out.push(el);
          el.children.forEach(walk);
        };
        this.children.forEach(walk);
      }
      return out;
    }
  }

  const body = new FakeElement('body');
  const win:  { listeners: Map<string, AnyListener[]>; addEventListener: (n: string, cb: AnyListener) => void; removeEventListener: (n: string, cb: AnyListener) => void; fire: (n: string, ev: unknown) => void; matchMedia: (q: string) => { matches: boolean }; setTimeout: typeof setTimeout } = {
    listeners: new Map(),
    addEventListener(n, cb) {
      const l = this.listeners.get(n) ?? [];
      l.push(cb);
      this.listeners.set(n, l);
    },
    removeEventListener(n, cb) {
      const l = this.listeners.get(n);
      if (!l) return;
      this.listeners.set(n, l.filter(x => x !== cb));
    },
    fire(n, ev) {
      const l = this.listeners.get(n);
      l?.slice().forEach(cb => cb(ev));
    },
    matchMedia: () => ({ matches: false }),
    setTimeout: globalThis.setTimeout,
  };

  const doc = {
    body,
    createElement: (tag: string) => new FakeElement(tag),
  };

  (globalThis as unknown as { document: unknown }).document = doc;
  (globalThis as unknown as { window:   unknown }).window   = win;
  (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = FakeElement;
  (globalThis as unknown as { CustomEvent: unknown }).CustomEvent = class {
    type: string;
    detail: unknown;
    bubbles: boolean;
    constructor(type: string, init?: { detail?: unknown; bubbles?: boolean }) {
      this.type = type;
      this.detail = init?.detail;
      this.bubbles = init?.bubbles ?? false;
    }
  };

  const root     = new FakeElement('div'); body.appendChild(root);
  const leftCol  = new FakeElement('div'); root.appendChild(leftCol);
  const center   = new FakeElement('div'); root.appendChild(center);
  const rightCol = new FakeElement('div'); root.appendChild(rightCol);

  root.rect     = { left: 0, top: 0, right: 800, bottom: 500 };
  leftCol.rect  = { left: 0,   top: 0, right: 200, bottom: 500 };
  center.rect   = { left: 200, top: 0, right: 600, bottom: 500 };
  rightCol.rect = { left: 600, top: 0, right: 800, bottom: 500 };

  return {
    root:     root     as unknown as HTMLElement,
    leftCol:  leftCol  as unknown as HTMLElement,
    center:   center   as unknown as HTMLElement,
    rightCol: rightCol as unknown as HTMLElement,
    firePointerDown: (target: HTMLElement, clientX: number, clientY: number) => {
      (target as unknown as FakeElement).dispatchEvent({
        type: 'pointerdown', button: 0, clientX, clientY,
        preventDefault: () => {}, stopPropagation: () => {},
      });
    },
    firePointerUp: (clientX: number, clientY: number) => {
      win.fire('pointerup', { type: 'pointerup', clientX, clientY });
    },
    firePointerMove: (clientX: number, clientY: number) => {
      win.fire('pointermove', { type: 'pointermove', clientX, clientY });
    },
    allChips: () => (root as unknown as FakeElement).querySelectorAll('.ne-toolbox-chip') as unknown as HTMLElement[],
  };
}

describe('toolbox mount + drag/drop', () => {
  let dom: ReturnType<typeof installDomShim>;
  let host: ToolboxHost;
  let graph: NodeGraph;
  let onGraphChanged: (() => void) & { mock: { calls: unknown[][] } };

  beforeEach(() => {
    dom = installDomShim();
    host = { root: dom.root, leftCol: dom.leftCol, center: dom.center, rightCol: dom.rightCol };
    graph = createGraph(1);
    onGraphChanged = vi.fn() as unknown as (() => void) & { mock: { calls: unknown[][] } };
  });

  it('renders one chip per registered NodeDefinition, grouped by side', () => {
    registerNodeDef(makeDef({ type: 'data.distance-to-sun', side: 'data',    label: 'Distance' }));
    registerNodeDef(makeDef({ type: 'sound.sine',           side: 'sound',   label: 'Sine'      }));
    registerNodeDef(makeDef({ type: 'sweeper.spokes',       side: 'sweeper', label: 'Spokes'    }));

    mountToolbox(host, { getGraph: () => graph, onGraphChanged });

    const chips = dom.allChips();
    expect(chips).toHaveLength(3);

    const types = chips.map(c => (c as unknown as { dataset: Record<string, string> }).dataset.type);
    expect(types.sort()).toEqual(['data.distance-to-sun', 'sound.sine', 'sweeper.spokes']);

    // Each side gets a labelled group.
    const labels = (dom.root as unknown as { querySelectorAll: (s: string) => { textContent: string }[] })
      .querySelectorAll('.ne-toolbox-group-label').map(l => l.textContent);
    expect(labels.sort()).toEqual(['DATA', 'SOUND', 'SWEEPER']);
  });

  it('a drop inside the matching column creates a node via addNode and fires onGraphChanged', () => {
    registerNodeDef(makeDef({ type: 'data.distance-to-sun', side: 'data', label: 'Distance' }));
    mountToolbox(host, { getGraph: () => graph, onGraphChanged });

    const chip = dom.allChips()[0]!;
    dom.firePointerDown(chip, 10, 10);
    // x=100, y=100 is inside leftCol rect (0..200 × 0..500).
    dom.firePointerMove(100, 100);
    dom.firePointerUp(100, 100);

    expect(graph.nodes).toHaveLength(1);
    const node = graph.nodes[0]!;
    expect(node.type).toBe('data.distance-to-sun');
    expect(node.side).toBe('data');
    expect(onGraphChanged).toHaveBeenCalledTimes(1);

    // Coords are column-relative: clientX 100 − leftCol.left 0 = 100.
    expect(node.x).toBe(100);
    expect(node.y).toBe(100);
  });

  it('rejects drops outside any valid zone (no node, no callback)', () => {
    registerNodeDef(makeDef({ type: 'data.a', side: 'data' }));
    mountToolbox(host, { getGraph: () => graph, onGraphChanged });

    const chip = dom.allChips()[0];
    dom.firePointerDown(chip, 10, 10);
    // 900 is outside rightCol (0..800) — no zone.
    dom.firePointerUp(900, 900);

    expect(graph.nodes).toHaveLength(0);
    expect(onGraphChanged).not.toHaveBeenCalled();
  });

  it('rejects drops in a mismatched column (data chip dropped over the sound column)', () => {
    registerNodeDef(makeDef({ type: 'data.a', side: 'data' }));
    mountToolbox(host, { getGraph: () => graph, onGraphChanged });

    const chip = dom.allChips()[0];
    dom.firePointerDown(chip, 10, 10);
    // rightCol is 600..800 — a data chip there should NOT land.
    dom.firePointerUp(700, 100);

    expect(graph.nodes).toHaveLength(0);
    expect(onGraphChanged).not.toHaveBeenCalled();
  });
});
