// src/__tests__/controls.test.ts
//
// Tests for controls: shape management, playback toggle, caches.

import { describe, it, expect, vi } from 'vitest';
import { CanvasShape } from '../shapes';
import { createInitialState } from '../state';
import {
  setActiveShape,
  deleteActiveShape,
  rebuildAllCaches,
} from '../controls';
import type { DomElements } from '../dom';

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
    patternSelectorEl: el() as unknown as HTMLElement,
    patternCardsEl: el() as unknown as HTMLElement,
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
    modeToggle: el() as unknown as HTMLElement,
    modeOptions: [] as unknown as NodeListOf<HTMLElement>,
    playPauseBtn: el() as unknown as HTMLButtonElement,
    soundMenu: el() as unknown as HTMLElement,
    instrumentBtns: [] as unknown as NodeListOf<HTMLButtonElement>,
    themeToggleBtn: el() as unknown as HTMLButtonElement,
    audioOverlay: el() as unknown as HTMLElement,
    syncAudioBtn: el() as unknown as HTMLElement,
    tourEl: el() as unknown as HTMLElement,
    tourSpot: el() as unknown as HTMLElement,
    tourCounter: el() as unknown as HTMLElement,
    tourText: el() as unknown as HTMLElement,
    tourGotIt: el() as unknown as HTMLElement,
    tourSkip: el() as unknown as HTMLElement,
  };
}

describe('setActiveShape', () => {
  it('selects a shape and deselects others', () => {
    const state = createInitialState();
    const s1 = new CanvasShape(100, 100, 'circle', 50);
    const s2 = new CanvasShape(200, 200, 'triangle', 40);
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
    const s1 = new CanvasShape(100, 100, 'circle', 50);
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
    const s1 = new CanvasShape(100, 100, 'circle', 50);
    const s2 = new CanvasShape(200, 200, 'triangle', 40);
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
    const s1 = new CanvasShape(100, 100, 'circle', 50);
    state.shapes.push(s1);
    state.activeShape = null;

    deleteActiveShape(state, dom);
    expect(state.shapes).toHaveLength(1);
  });

  it('clears flash cooldown for deleted shape', () => {
    const state = createInitialState();
    const dom = mockDom();
    const s1 = new CanvasShape(100, 100, 'circle', 50);
    state.shapes.push(s1);
    state.activeShape = s1;
    state.flashCooldowns.set(s1.id, 1000);

    deleteActiveShape(state, dom);
    expect(state.flashCooldowns.has(s1.id)).toBe(false);
  });
});

describe('rebuildAllCaches', () => {
  it('rebuilds intersection caches for all shapes', () => {
    const state = createInitialState();
    const s1 = new CanvasShape(400, 300, 'circle', 80);
    const s2 = new CanvasShape(400, 300, 'rectangle', 60);
    state.shapes.push(s1, s2);

    // Should not throw even with empty link lines
    rebuildAllCaches(state);
    expect(s1.cachedIntersections).toEqual([]);
    expect(s2.cachedIntersections).toEqual([]);
  });

  it('rebuilds sweep ticks for sweeper shapes', () => {
    const state = createInitialState();
    const sw = new CanvasShape(400, 300, 'sweeper', 200);
    state.shapes.push(sw);
    state.orbitalMaxRadius = 300;

    rebuildAllCaches(state);
    // Sweeper should have sweep ticks computed
    expect(sw.sweepTicks).toBeDefined();
  });
});
