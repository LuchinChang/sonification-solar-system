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
    playgroundDrawer: el() as unknown as HTMLElement,
    pgOperator: el() as unknown as HTMLSelectElement,
    pgBalance: el() as unknown as HTMLInputElement,
    pgPhase: el() as unknown as HTMLInputElement,
    pgFmIndex: el() as unknown as HTMLInputElement,
    pgRatioMode: el() as unknown as HTMLSelectElement,
    pgFreeRatio: el() as unknown as HTMLInputElement,
    pgF0: el() as unknown as HTMLInputElement,
    pgWrap: el() as unknown as HTMLInputElement,
    pgRadiusMapping: el() as unknown as HTMLSelectElement,
    pgSustain: el() as unknown as HTMLInputElement,
    pgGain: el() as unknown as HTMLInputElement,
    pgCopyCode: el() as unknown as HTMLButtonElement,
    cardioidControlsEl: el() as unknown as HTMLElement,
    cardioidNSliderMultiplier: el() as unknown as HTMLInputElement,
    cardioidMultiplierValueEl: el() as unknown as HTMLElement,
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

  it('sweeper-spawned advances from step 0 to step 1', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    expect(tour.currentStep).toBe(1);
  });

  it('editor-opened advances from step 1 to step 2', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned'); // 0 → 1
    tour.notify('editor-opened');    // 1 → 2
    expect(tour.currentStep).toBe(2);
  });

  it('cable-connected advances from step 2 to step 3', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');  // 0 → 1
    tour.notify('editor-opened');    // 1 → 2
    tour.notify('cable-connected');  // 2 → 3
    expect(tour.currentStep).toBe(3);
  });

  it('play-pressed advances from step 3 to step 4 (done)', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');  // 0 → 1
    tour.notify('editor-opened');    // 1 → 2
    tour.notify('cable-connected');  // 2 → 3
    tour.notify('play-pressed');     // 3 → 4
    expect(tour.currentStep).toBe(4);
  });

  it('notify at wrong step is a no-op', () => {
    const tour = createTourController(dom);
    tour.start();
    // Step 0 expects 'sweeper-spawned', not 'play-pressed'
    tour.notify('play-pressed');
    expect(tour.currentStep).toBe(0);
  });

  it('notify when tour is inactive is a no-op', () => {
    const tour = createTourController(dom);
    // Don't start the tour
    tour.notify('sweeper-spawned');
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

  it('has 6 steps: spawn → editor → cable → play → pattern picker → done', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    tour.notify('editor-opened');
    tour.notify('cable-connected');
    tour.notify('play-pressed');
    tour.notify('pattern-opened');
    expect(tour.currentStep).toBe(5);
    expect(tour.isActive).toBe(true);
  });

  it('pattern-opened advances from step 4 to step 5', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    tour.notify('editor-opened');
    tour.notify('cable-connected');
    tour.notify('play-pressed');
    expect(tour.currentStep).toBe(4);
    tour.notify('pattern-opened');
    expect(tour.currentStep).toBe(5);
  });

  it('back() re-shows the previous step without undoing anything', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    tour.notify('editor-opened');
    expect(tour.currentStep).toBe(2);
    tour.back();
    expect(tour.currentStep).toBe(1);
    expect(tour.isActive).toBe(true);
  });

  it('back() at step 0 is a no-op', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.back();
    expect(tour.currentStep).toBe(0);
    expect(tour.isActive).toBe(true);
  });

  it('next() advances without waiting for the step action', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.next();
    expect(tour.currentStep).toBe(1);
  });

  it('next() on the final step ends the tour', () => {
    const tour = createTourController(dom);
    tour.start();
    for (let i = 0; i < 5; i++) tour.next();
    expect(tour.currentStep).toBe(5);
    tour.next();
    expect(tour.isActive).toBe(false);
    expect(localStorage.getItem('intro-tour-done')).toBe('true');
  });

  it('an out-of-order action still advances only its own step', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.next(); // user skipped ahead past "spawn"
    tour.notify('sweeper-spawned'); // late notify for step 0 — must not advance step 1
    expect(tour.currentStep).toBe(1);
  });

  it('pattern-confirmed on the final step completes the tour', () => {
    const tour = createTourController(dom);
    tour.start();
    for (let i = 0; i < 5; i++) tour.next(); // walk to the final step
    expect(tour.currentStep).toBe(5);
    tour.notify('pattern-confirmed');
    expect(tour.isActive).toBe(false);
    expect(localStorage.getItem('intro-tour-done')).toBe('true');
  });

  it('pattern-confirmed before the final step is a no-op', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('pattern-confirmed');
    expect(tour.currentStep).toBe(0);
    expect(tour.isActive).toBe(true);
  });

  it('start() while active does not reset progress', () => {
    // Regression: finishDrawAnimation fires tour.start() after every reveal —
    // a reveal triggered mid-tour must not bounce the user back to step 0.
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    tour.notify('editor-opened');
    expect(tour.currentStep).toBe(2);
    tour.start();
    expect(tour.currentStep).toBe(2);
    expect(tour.isActive).toBe(true);
  });
});
