// src/__tests__/tour.test.ts
//
// Tests for the intro tour state machine.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTourController } from '../tour';
import type { DomElements } from '../dom';

// Mock localStorage for Node environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// Mock document.addEventListener for ESC key handler
if (typeof document === 'undefined') {
  (globalThis as Record<string, unknown>).document = {
    addEventListener: vi.fn(),
    body: {
      appendChild: vi.fn(),
      style: {},
    },
    createElement: vi.fn(() => ({
      id: '',
      textContent: '',
      classList: { add: vi.fn(), remove: vi.fn() },
      remove: vi.fn(),
    })),
    getElementById: vi.fn(() => null),
  };
}

// Mock window.location for URL param check
if (typeof window === 'undefined') {
  (globalThis as Record<string, unknown>).window = {
    location: { search: '' },
  };
}

// Minimal mock of the DOM elements the tour uses
function mockDomElements(): DomElements {
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
    classList: classList(),
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
    closest: vi.fn(() => null),
    getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 100, height: 50 })),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  });

  return {
    canvas: el() as unknown as HTMLCanvasElement,
    ctx: {} as CanvasRenderingContext2D,
    captionEl: el() as unknown as HTMLElement,
    toastEl: el() as unknown as HTMLElement,
    patternSelectorEl: el() as unknown as HTMLElement,
    patternCardsEl: el() as unknown as HTMLElement,
    telemetryTextarea: el() as unknown as HTMLTextAreaElement,
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

describe('TourController', () => {
  let dom: DomElements;

  beforeEach(() => {
    dom = mockDomElements();
    // Clear localStorage so shouldShowTour returns true
    localStorage.removeItem('intro-tour-done');
  });

  it('starts at step 0', () => {
    const tour = createTourController(dom);
    tour.start();
    expect(tour.isActive).toBe(true);
    expect(tour.currentStep).toBe(0);
  });

  it('notify with dock-shown advances from step 0 to step 1', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('dock-shown');
    expect(tour.currentStep).toBe(1);
  });

  it('notify with shape-spawned advances from step 1', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('dock-shown');   // 0 → 1
    tour.notify('shape-spawned'); // 1 → 2
    expect(tour.currentStep).toBe(2);
  });

  it('notify at wrong step is a no-op', () => {
    const tour = createTourController(dom);
    tour.start();
    // Step 0 expects 'dock-shown', not 'shape-spawned'
    tour.notify('shape-spawned');
    expect(tour.currentStep).toBe(0);
  });

  it('notify when tour is inactive is a no-op', () => {
    const tour = createTourController(dom);
    // Don't start the tour
    tour.notify('dock-shown');
    expect(tour.isActive).toBe(false);
  });

  it('end sets localStorage', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.end();
    expect(localStorage.getItem('intro-tour-done')).toBe('true');
    expect(tour.isActive).toBe(false);
  });

  it('end with skipped=true still sets localStorage', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.end(true);
    expect(localStorage.getItem('intro-tour-done')).toBe('true');
    expect(tour.isActive).toBe(false);
  });

  it('does not start if tour was already completed', () => {
    localStorage.setItem('intro-tour-done', 'true');
    const tour = createTourController(dom);
    tour.start();
    expect(tour.isActive).toBe(false);
  });

  it('instrument-picked advances from step 2 or step 5', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('dock-shown');       // 0 → 1
    tour.notify('shape-spawned');    // 1 → 2
    tour.notify('instrument-picked'); // 2 → 3
    expect(tour.currentStep).toBe(3);
  });

  it('play-pressed advances from step 3', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('dock-shown');        // 0 → 1
    tour.notify('shape-spawned');     // 1 → 2
    tour.notify('instrument-picked'); // 2 → 3
    tour.notify('play-pressed');      // 3 → 4
    expect(tour.currentStep).toBe(4);
  });
});
