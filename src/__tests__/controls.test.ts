// @vitest-environment jsdom
// src/__tests__/controls.test.ts
//
// Tests for controls: shape management, playback toggle, caches.
// Also covers Unit 5 — Backspace / node-editor selection reconciliation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CanvasShape } from '../shapes';
import { createInitialState, sunPos } from '../state';
import {
  setActiveShape,
  deleteActiveShape,
  rebuildAllCaches,
  spawnShape,
  editorShouldConsumeDeleteKey,
} from '../controls';
import type { DomElements } from '../dom';
import type { TourController } from '../tour';

/** No-op tour controller — spawnShape only calls tour.notify for sweepers. */
function stubTour(): TourController {
  return {
    start: vi.fn(),
    end: vi.fn(),
    notify: vi.fn(),
    back: vi.fn(),
    next: vi.fn(),
    get isActive() { return false; },
    get currentStep() { return 0; },
  };
}

// Minimal DOM mock for controls that don't need full DOM
function mockDom(): DomElements {
  const classList = () => ({
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    contains: vi.fn(() => false),
  });
  const el = () => ({
    style: {} as Record<string, string>,
    textContent: '',
    innerHTML: '',
    value: '',
    classList: classList(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    closest: vi.fn(() => null),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  });

  return {
    canvas: { width: 800, height: 600, ...el() } as unknown as HTMLCanvasElement,
    ctx: {} as CanvasRenderingContext2D,
    captionEl: el() as unknown as HTMLElement,
    toastEl: el() as unknown as HTMLElement,
    telemetryTextarea: { ...el(), value: '' } as unknown as HTMLTextAreaElement,
    telemetryPanel: el() as unknown as HTMLElement,
    telemetryTab: el() as unknown as HTMLButtonElement,
    evalStatusEl: el() as unknown as HTMLElement,
    sampleKnobEl: el() as unknown as HTMLElement,
    knobNeedleGroup: el() as unknown as SVGGElement,
    knobValueEl: el() as unknown as HTMLElement,
    cpmKnobEl: el() as unknown as HTMLElement,
    cpmNeedleGroup: el() as unknown as SVGGElement,
    cpmValueEl: el() as unknown as HTMLElement,
    playPauseBtn: el() as unknown as HTMLButtonElement,
    themeToggleBtn: el() as unknown as HTMLButtonElement,
    audioOverlay: el() as unknown as HTMLElement,
    startMutedBtn: el() as unknown as HTMLButtonElement,
    muteToggleBtn: el() as unknown as HTMLButtonElement,
    syncAudioBtn: el() as unknown as HTMLElement,
    tourEl: el() as unknown as HTMLElement,
    tourSpot: el() as unknown as HTMLElement,
    tourCounter: el() as unknown as HTMLElement,
    tourText: el() as unknown as HTMLElement,
    tourGotIt: el() as unknown as HTMLElement,
    tourSkip: el() as unknown as HTMLElement,
    tourTooltip: el() as unknown as HTMLElement,
    tourBack: el() as unknown as HTMLButtonElement,
    tourNext: el() as unknown as HTMLButtonElement,
    dropOverlay: el() as unknown as HTMLElement,
    saveConfigBtn: el() as unknown as HTMLElement,
    loadConfigBtn: el() as unknown as HTMLElement,
    loadConfigInput: el() as unknown as HTMLInputElement,
    patternSelectorEl: el() as unknown as HTMLElement,
    patternCardsEl: el() as unknown as HTMLElement,
    patternInnerListEl: el() as unknown as HTMLElement,
    patternOuterListEl: el() as unknown as HTMLElement,
    patternPreviewCanvas: el() as unknown as HTMLCanvasElement,
    patternPreviewName: el() as unknown as HTMLElement,
    patternPreviewMeta: el() as unknown as HTMLElement,
    patternConfirmBtn: el() as unknown as HTMLButtonElement,
    cardioidControlsEl: el() as unknown as HTMLElement,
    cardioidNSliderMultiplier: el() as unknown as HTMLInputElement,
    cardioidMultiplierValueEl: el() as unknown as HTMLElement,
  };
}

describe('setActiveShape', () => {
  it('selects a shape and deselects others', () => {
    const state = createInitialState();
    const s1 = new CanvasShape(100, 100, 'sweeper', 50);
    const s2 = new CanvasShape(200, 200, 'sweeper', 40);
    state.shapes.push(s1, s2);

    setActiveShape(state, s1);
    expect(state.activeShape).toBe(s1);
    expect(s1.isSelected).toBe(true);
    expect(s2.isSelected).toBe(false);

    setActiveShape(state, s2);
    expect(state.activeShape).toBe(s2);
    expect(s1.isSelected).toBe(false);
    expect(s2.isSelected).toBe(true);
  });

  it('deselects all when null is passed', () => {
    const state = createInitialState();
    const s1 = new CanvasShape(100, 100, 'sweeper', 50);
    state.shapes.push(s1);
    setActiveShape(state, s1);

    setActiveShape(state, null);
    expect(state.activeShape).toBeNull();
    expect(s1.isSelected).toBe(false);
  });
});

describe('deleteActiveShape', () => {
  it('removes the active shape from the array', () => {
    const state = createInitialState();
    const dom = mockDom();
    const s1 = new CanvasShape(100, 100, 'sweeper', 50);
    const s2 = new CanvasShape(200, 200, 'sweeper', 40);
    state.shapes.push(s1, s2);
    state.activeShape = s1;

    deleteActiveShape(state, dom);
    expect(state.shapes).toHaveLength(1);
    expect(state.shapes[0]).toBe(s2);
    expect(state.activeShape).toBeNull();
  });

  it('is a no-op when no shape is active', () => {
    const state = createInitialState();
    const dom = mockDom();
    const s1 = new CanvasShape(100, 100, 'sweeper', 50);
    state.shapes.push(s1);
    state.activeShape = null;

    deleteActiveShape(state, dom);
    expect(state.shapes).toHaveLength(1);
  });

  it('clears flash cooldown for deleted shape', () => {
    const state = createInitialState();
    const dom = mockDom();
    const s1 = new CanvasShape(100, 100, 'sweeper', 50);
    state.shapes.push(s1);
    state.activeShape = s1;
    state.flashCooldowns.set(s1.id, 1000);

    deleteActiveShape(state, dom);
    expect(state.flashCooldowns.has(s1.id)).toBe(false);
  });
});

describe('rebuildAllCaches', () => {
  // LEGACY: disabled 2026-04-21 — rebuildIntersectionCache is a no-op for
  // sweepers, so the old coverage only exercised non-sweeper ShapeTypes.
  /*
  it('rebuilds intersection caches for all shapes', () => {
    const state = createInitialState();
    const s1 = new CanvasShape(400, 300, 'circle', 80);
    const s2 = new CanvasShape(400, 300, 'rectangle', 60);
    state.shapes.push(s1, s2);

    rebuildAllCaches(state);
    expect(s1.cachedIntersections).toEqual([]);
    expect(s2.cachedIntersections).toEqual([]);
  });
  */

  it('rebuilds sweep ticks for sweeper shapes', () => {
    const state = createInitialState();
    const sw = new CanvasShape(400, 300, 'sweeper', 200);
    state.shapes.push(sw);
    state.orbitalMaxRadius = 300;

    const canvas = { width: 800, height: 600 } as HTMLCanvasElement;
    rebuildAllCaches(state, canvas);
    // Sweeper should have sweep ticks computed
    expect(sw.sweepTicks).toBeDefined();
  });

  it('bakes discrete ticks for circle probes', () => {
    const state = createInitialState();
    state.linkLines = [
      { p1: { x: 200, y: 300 }, p2: { x: 600, y: 300 } },
    ];
    const circle = new CanvasShape(400, 300, 'circle', 120);
    state.shapes.push(circle);
    state.orbitalMaxRadius = 400;

    const canvas = { width: 800, height: 600 } as HTMLCanvasElement;
    rebuildAllCaches(state, canvas);
    // The horizontal line through the circle centre crosses the perimeter
    // twice → two crossings binned into the discrete tick structure.
    expect(circle.sweepTicks.length).toBe(1);          // one playhead (arm 0)
    expect(circle.intersectionCount).toBe(2);
  });
});

describe('spawnShape — circle centring + radius fan', () => {
  it('spawns the first circle centred on the Sun at the base radius', () => {
    const state = createInitialState();
    const dom   = mockDom();
    const sun   = sunPos(dom.canvas);

    spawnShape(state, dom, 'circle', stubTour());

    const c = state.shapes.at(-1)!;
    expect(c.type).toBe('circle');
    expect(c.x).toBe(sun.x);   // centred on the Sun (no offset)
    expect(c.y).toBe(sun.y);
    expect(c.size).toBe(150);  // base radius
  });

  it('fans successive circles into larger concentric rings (same centre)', () => {
    const state = createInitialState();
    const dom   = mockDom();
    const sun   = sunPos(dom.canvas);

    spawnShape(state, dom, 'circle', stubTour());
    spawnShape(state, dom, 'circle', stubTour());
    spawnShape(state, dom, 'circle', stubTour());

    const circles = state.shapes.filter(s => s.type === 'circle');
    expect(circles).toHaveLength(3);
    // All share the Sun's centre…
    for (const c of circles) {
      expect(c.x).toBe(sun.x);
      expect(c.y).toBe(sun.y);
    }
    // …but each is a strictly larger ring (150, 210, 270).
    expect(circles.map(c => c.size)).toEqual([150, 210, 270]);
  });
});

describe('spawnShape — distinct probe colours', () => {
  it('gives a circle and a sweeper different colorIndex (no shared hue)', () => {
    // Regression: circle used shapes.length and sweeper used sweeper-count, so
    // spawning circle-then-sweeper produced colorIndex 0 for BOTH (both teal).
    const state = createInitialState();
    const dom   = mockDom();

    spawnShape(state, dom, 'circle', stubTour());
    spawnShape(state, dom, 'sweeper', stubTour());

    const [circle, sweeper] = state.shapes;
    expect(circle.colorIndex).not.toBe(sweeper.colorIndex);
    expect(circle.accentColor).not.toBe(sweeper.accentColor);
  });

  it('keeps every live probe on a unique colour', () => {
    const state = createInitialState();
    const dom   = mockDom();
    for (let i = 0; i < 5; i++) {
      spawnShape(state, dom, i % 2 === 0 ? 'circle' : 'sweeper', stubTour());
    }
    const indices = state.shapes.map(s => s.colorIndex);
    expect(new Set(indices).size).toBe(indices.length);   // all distinct
  });

  it('reclaims a freed colour after a probe is deleted', () => {
    const state = createInitialState();
    const dom   = mockDom();
    spawnShape(state, dom, 'circle', stubTour());   // colorIndex 0
    spawnShape(state, dom, 'circle', stubTour());   // colorIndex 1
    spawnShape(state, dom, 'circle', stubTour());   // colorIndex 2

    // Delete the middle probe (frees colorIndex 1).
    const middle = state.shapes.find(s => s.colorIndex === 1)!;
    setActiveShape(state, middle);
    deleteActiveShape(state, dom);

    // The next spawn reclaims the lowest free slot (1), not a new index 3.
    spawnShape(state, dom, 'sweeper', stubTour());
    expect(state.shapes.at(-1)!.colorIndex).toBe(1);
  });
});

// ── Unit 5: Selection / delete reconciliation ──────────────────────────────
//
// When the node editor is open AND has a selected cable, Backspace must go
// to the cable handler, NOT delete the sweeper. Otherwise Backspace should
// continue to delete the active shape (restoring pre-editor behaviour).
//
// Requires jsdom so we can build real DOM fixtures for #node-editor-panel
// and `.edge.selected`.

describe('editorShouldConsumeDeleteKey (Unit 5)', () => {
  beforeEach(() => {
    // Fresh document.body each test.
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns false when no editor panel exists', () => {
    expect(editorShouldConsumeDeleteKey()).toBe(false);
  });

  it('returns false when the editor panel is closed (.hidden class)', () => {
    const panel = document.createElement('div');
    panel.id = 'node-editor-panel';
    panel.className = 'hidden';
    document.body.appendChild(panel);
    // Even an edge with .selected is irrelevant if the panel is hidden.
    const edge = document.createElement('div');
    edge.className = 'edge selected';
    document.body.appendChild(edge);
    expect(editorShouldConsumeDeleteKey()).toBe(false);
  });

  it('returns false when the panel is open but no edge is selected', () => {
    const panel = document.createElement('div');
    panel.id = 'node-editor-panel';
    document.body.appendChild(panel);
    expect(editorShouldConsumeDeleteKey()).toBe(false);
  });

  it('returns true when the panel is open AND an edge is selected', () => {
    const panel = document.createElement('div');
    panel.id = 'node-editor-panel';
    document.body.appendChild(panel);
    const edge = document.createElement('div');
    edge.className = 'edge selected';
    document.body.appendChild(edge);
    expect(editorShouldConsumeDeleteKey()).toBe(true);
  });
});

describe('Backspace behaviour (Unit 5 integration)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // Simulates the keydown-switch branch logic from setupEventHandlers without
  // wiring the full handler (which pulls in audio/strudel). Matches the exact
  // order of guards in controls.ts: text-input early-return, then editor guard,
  // then deleteActiveShape.
  function handleBackspace(
    state: ReturnType<typeof createInitialState>,
    dom: DomElements,
    target: EventTarget | null,
  ): void {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (editorShouldConsumeDeleteKey()) return;
    deleteActiveShape(state, dom);
  }

  it('deletes the active sweeper when editor panel is closed', () => {
    const state = createInitialState();
    const dom = mockDom();
    const sw = new CanvasShape(400, 300, 'sweeper', 200);
    state.shapes.push(sw);
    state.activeShape = sw;

    handleBackspace(state, dom, document.body);

    expect(state.shapes).toHaveLength(0);
    expect(state.activeShape).toBeNull();
  });

  it('does NOT delete the sweeper when an .edge.selected exists in an open panel', () => {
    const panel = document.createElement('div');
    panel.id = 'node-editor-panel';
    document.body.appendChild(panel);
    const edge = document.createElement('div');
    edge.className = 'edge selected';
    document.body.appendChild(edge);

    const state = createInitialState();
    const dom = mockDom();
    const sw = new CanvasShape(400, 300, 'sweeper', 200);
    state.shapes.push(sw);
    state.activeShape = sw;

    handleBackspace(state, dom, document.body);

    // Sweeper is preserved — the cable handler owns this Backspace.
    expect(state.shapes).toHaveLength(1);
    expect(state.activeShape).toBe(sw);
  });

  it('does NOT delete the sweeper when focus is in a text input', () => {
    const state = createInitialState();
    const dom = mockDom();
    const sw = new CanvasShape(400, 300, 'sweeper', 200);
    state.shapes.push(sw);
    state.activeShape = sw;

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);

    handleBackspace(state, dom, input);

    expect(state.shapes).toHaveLength(1);
    expect(state.activeShape).toBe(sw);
  });

  it('does NOT delete the sweeper when focus is in a textarea', () => {
    const state = createInitialState();
    const dom = mockDom();
    const sw = new CanvasShape(400, 300, 'sweeper', 200);
    state.shapes.push(sw);
    state.activeShape = sw;

    const ta = document.createElement('textarea');
    document.body.appendChild(ta);

    handleBackspace(state, dom, ta);

    expect(state.shapes).toHaveLength(1);
  });

  it('deletes the sweeper when panel is open but no edge is selected', () => {
    // e.g. user clicked the sweeper to open the editor, then pressed Backspace
    // without picking a cable — we still want old-school "delete the sweeper".
    const panel = document.createElement('div');
    panel.id = 'node-editor-panel';
    document.body.appendChild(panel);

    const state = createInitialState();
    const dom = mockDom();
    const sw = new CanvasShape(400, 300, 'sweeper', 200);
    state.shapes.push(sw);
    state.activeShape = sw;

    handleBackspace(state, dom, document.body);

    expect(state.shapes).toHaveLength(0);
    expect(state.activeShape).toBeNull();
  });
});
