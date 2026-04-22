// src/__tests__/node-editor-animations.test.ts
//
// Unit 12 — tests for the cable connection animations.
//
// Vitest runs in a node environment without jsdom, so we hand-roll just
// enough of the DOM surface each helper touches. Keeps the tests fast
// and the dependency graph clean.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Tiny DOM fakes ────────────────────────────────────────────────────────────

interface FakeClassList {
  add:      (c: string) => void;
  remove:   (c: string) => void;
  contains: (c: string) => boolean;
}

interface FakeElement {
  tagName:    string;
  classList:  FakeClassList;
  style:      Record<string, string>;
  children:   FakeElement[];
  parentNode:    FakeElement | null;
  parentElement: FakeElement | null;
  ownerDocument: FakeDocument;
  ownerSVGElement?: FakeElement | null;
  offsetWidth: number;
  appendChild: (child: FakeElement) => FakeElement;
  removeChild: (child: FakeElement) => FakeElement;
  getBoundingClientRect: () => { left: number; top: number; right: number; bottom: number; width: number; height: number };
  getBBox?: () => { x: number; y: number; width: number; height: number };
  getTotalLength?: () => number;
  getPointAtLength?: (len: number) => { x: number; y: number };
  addEventListener: (type: string, fn: (ev: unknown) => void) => void;
  removeEventListener: (type: string, fn: (ev: unknown) => void) => void;
  dispatchEvent: (ev: { type: string; detail?: unknown }) => boolean;
  _listeners: Map<string, Set<(ev: unknown) => void>>;
}

interface FakeDocument {
  body: FakeElement;
  createElement: (tag: string) => FakeElement;
  getElementById: (id: string) => FakeElement | null;
  _byId: Map<string, FakeElement>;
}

function makeClassList(): FakeClassList {
  const set = new Set<string>();
  return {
    add:      (c: string) => { set.add(c); },
    remove:   (c: string) => { set.delete(c); },
    contains: (c: string) => set.has(c),
  };
}

function makeElement(tag: string, doc: FakeDocument): FakeElement {
  const el: FakeElement = {
    tagName:   tag.toUpperCase(),
    classList: makeClassList(),
    style:     {},
    children:  [],
    parentNode:    null,
    parentElement: null,
    ownerDocument: doc,
    ownerSVGElement: null,
    offsetWidth: 0,
    appendChild(child) {
      child.parentNode    = this;
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i !== -1) this.children.splice(i, 1);
      child.parentNode    = null;
      child.parentElement = null;
      return child;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 };
    },
    addEventListener(type, fn) {
      let s = this._listeners.get(type);
      if (!s) { s = new Set(); this._listeners.set(type, s); }
      s.add(fn);
    },
    removeEventListener(type, fn) {
      this._listeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      const s = this._listeners.get(ev.type);
      if (!s) return true;
      for (const fn of s) fn(ev);
      return true;
    },
    _listeners: new Map(),
  };
  return el;
}

function makeDocument(): FakeDocument {
  const doc: Partial<FakeDocument> = { _byId: new Map() };
  const body = makeElement('body', doc as FakeDocument);
  doc.body = body;
  doc.createElement = (tag: string) => makeElement(tag, doc as FakeDocument);
  doc.getElementById = (id: string) => doc._byId!.get(id) ?? null;
  return doc as FakeDocument;
}

function makeSvgPath(doc: FakeDocument, totalLen = 100): FakeElement {
  const svg = makeElement('svg', doc);
  const path = makeElement('path', doc);
  path.ownerSVGElement = svg;
  path.getTotalLength = () => totalLen;
  path.getPointAtLength = (len: number) => ({ x: len, y: 0 });
  path.getBBox = () => ({ x: 0, y: 0, width: totalLen, height: 1 });
  svg.appendChild(path);
  return path;
}

// ── Globals wiring ───────────────────────────────────────────────────────────

let reducedMotion = false;

function installWindowAndDocument(): { doc: FakeDocument; panel: FakeElement } {
  const doc = makeDocument();
  const panel = makeElement('div', doc);
  panel.ownerDocument = doc;
  doc._byId.set('node-editor-panel', panel);
  doc.body.appendChild(panel);

  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).window = {
    matchMedia: (q: string) => ({
      matches: reducedMotion && q.includes('reduce'),
      media:   q,
      addEventListener:    () => {},
      removeEventListener: () => {},
    }),
  };
  // requestAnimationFrame → immediate callback for deterministic tests.
  (globalThis as Record<string, unknown>).requestAnimationFrame =
    (cb: (t: number) => void) => { cb(0); return 1; };

  return { doc, panel };
}

// Vitest fake timers so we can drive setTimeout deterministically.

beforeEach(() => {
  reducedMotion = false;
  vi.useFakeTimers();
  installWindowAndDocument();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).requestAnimationFrame;
});

// ── Tests ────────────────────────────────────────────────────────────────────

import {
  snapPop,
  particleTrail,
  hueFade,
  installGraphChangedAutoWire,
  _resetAutoWireForTests,
} from '../node-editor/animations';

describe('snapPop', () => {
  it('toggles ne-snap-pop class and removes it after duration', () => {
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const el = doc.createElement('div');

    const cancel = snapPop(el as unknown as Element);

    expect(el.classList.contains('ne-snap-pop')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(el.classList.contains('ne-snap-pop')).toBe(false);

    // Cancel handle is callable and idempotent after fire.
    expect(() => cancel()).not.toThrow();
  });

  it('respects a custom className', () => {
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const el = doc.createElement('div');

    snapPop(el as unknown as Element, { className: 'custom-pop' });
    expect(el.classList.contains('custom-pop')).toBe(true);
  });

  it('snaps to final state within 50ms when prefers-reduced-motion', () => {
    reducedMotion = true;
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const el = doc.createElement('div');

    snapPop(el as unknown as Element);
    expect(el.classList.contains('ne-snap-pop')).toBe(true);
    vi.advanceTimersByTime(50);
    expect(el.classList.contains('ne-snap-pop')).toBe(false);
  });
});

describe('particleTrail', () => {
  it('spawns particles along the path and removes them after fade', () => {
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const path = makeSvgPath(doc, 80);
    const host = doc.createElement('div');
    host.appendChild(path.ownerSVGElement!);
    doc.body.appendChild(host);

    const cancel = particleTrail(
      path as unknown as SVGPathElement,
      { count: 4, spawnStepMs: 10, fadeMs: 30, container: host as unknown as Element },
    );
    expect(typeof cancel).toBe('function');

    // Advance past all spawn ticks (0, 10, 20, 30).
    vi.advanceTimersByTime(35);
    const midCount = host.children.filter(c => c.classList.contains('ne-particle-dot')).length;
    expect(midCount).toBeGreaterThan(0);

    // Advance past fade + cleanup.
    vi.advanceTimersByTime(200);
    const finalCount = host.children.filter(c => c.classList.contains('ne-particle-dot')).length;
    expect(finalCount).toBe(0);
  });

  it('is a no-op under prefers-reduced-motion', () => {
    reducedMotion = true;
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const path = makeSvgPath(doc, 50);
    doc.body.appendChild(path.ownerSVGElement!);

    particleTrail(path as unknown as SVGPathElement);
    vi.advanceTimersByTime(500);

    const dots = doc.body.children.filter(c => c.classList.contains('ne-particle-dot'));
    expect(dots.length).toBe(0);
  });

  it('cancel handle aborts pending spawns', () => {
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const path = makeSvgPath(doc, 60);
    doc.body.appendChild(path.ownerSVGElement!);

    const cancel = particleTrail(
      path as unknown as SVGPathElement,
      { count: 5, spawnStepMs: 20, fadeMs: 20 },
    );
    cancel();
    vi.advanceTimersByTime(200);
    const dots = doc.body.children.filter(c => c.classList.contains('ne-particle-dot'));
    expect(dots.length).toBe(0);
  });
});

describe('hueFade', () => {
  it('applies ne-hue-fade class and removes it after duration', () => {
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const edge = doc.createElement('path');

    hueFade(edge as unknown as Element);
    expect(edge.classList.contains('ne-hue-fade')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(edge.classList.contains('ne-hue-fade')).toBe(false);
  });

  it('is a no-op under prefers-reduced-motion', () => {
    reducedMotion = true;
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const edge = doc.createElement('path');

    hueFade(edge as unknown as Element);
    expect(edge.classList.contains('ne-hue-fade')).toBe(false);
  });
});

describe('installGraphChangedAutoWire', () => {
  it('fires helpers when an edge-complete graphChanged event is dispatched', () => {
    _resetAutoWireForTests();
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const panel = doc.getElementById('node-editor-panel')!;

    const cancel = installGraphChangedAutoWire(panel as unknown as Element);
    expect(typeof cancel).toBe('function');

    const port = doc.createElement('div');
    const edge = doc.createElement('path');
    const path = makeSvgPath(doc, 40);
    doc.body.appendChild(path.ownerSVGElement!);

    panel.dispatchEvent({
      type: 'graphChanged',
      detail: {
        kind:   'edge-complete',
        portEl: port,
        pathEl: path,
        edgeEl: edge,
      },
    });

    expect(port.classList.contains('ne-snap-pop')).toBe(true);
    expect(edge.classList.contains('ne-hue-fade')).toBe(true);

    cancel();
  });

  it('ignores unrelated graphChanged kinds', () => {
    _resetAutoWireForTests();
    const doc = (globalThis as Record<string, unknown>).document as FakeDocument;
    const panel = doc.getElementById('node-editor-panel')!;

    installGraphChangedAutoWire(panel as unknown as Element);
    const port = doc.createElement('div');
    panel.dispatchEvent({
      type: 'graphChanged',
      detail: { kind: 'node-added', portEl: port },
    });
    expect(port.classList.contains('ne-snap-pop')).toBe(false);
  });
});
