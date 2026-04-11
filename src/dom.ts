// src/dom.ts
//
// DOM element registry — all getElementById/querySelector calls consolidated
// into a single typed lookup resolved once at startup.

export interface DomElements {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  // Captions & toasts
  captionEl: HTMLElement;
  toastEl: HTMLElement;

  // Pattern selector
  patternSelectorEl: HTMLElement;
  patternCardsEl: HTMLElement;

  // Telemetry panel
  telemetryTextarea: HTMLTextAreaElement;
  telemetryPanel: HTMLElement;
  telemetryTab: HTMLButtonElement;
  evalStatusEl: HTMLElement;

  // Sample rate knob
  sampleKnobEl: HTMLElement;
  knobNeedleGroup: SVGGElement;
  knobValueEl: HTMLElement;

  // CPM knob
  cpmKnobEl: HTMLElement;
  cpmNeedleGroup: SVGGElement;
  cpmValueEl: HTMLElement;

  // Playback mode toggle
  modeToggle: HTMLElement;
  modeOptions: NodeListOf<HTMLElement>;

  // Play/Pause
  playPauseBtn: HTMLButtonElement;

  // Instrument selection
  soundMenu: HTMLElement;
  instrumentBtns: NodeListOf<HTMLButtonElement>;

  // Theme
  themeToggleBtn: HTMLButtonElement;

  // Audio overlay
  audioOverlay: HTMLElement;

  // Sync button
  syncAudioBtn: HTMLElement;

  // Tour
  tourEl: HTMLElement;
  tourSpot: HTMLElement;
  tourCounter: HTMLElement;
  tourText: HTMLElement;
  tourGotIt: HTMLElement;
  tourSkip: HTMLElement;

  // Save / load config snapshot
  dropOverlay: HTMLElement;
  saveConfigBtn: HTMLElement;
  loadConfigBtn: HTMLElement;
  loadConfigInput: HTMLInputElement;
}

function getEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`DOM element #${id} not found`);
  return el;
}

export function resolveDomElements(): DomElements {
  const canvas = getEl('simCanvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const modeToggle = getEl('mode-toggle');
  const soundMenu = getEl('sound-menu');

  return {
    canvas,
    ctx,

    captionEl: getEl('draw-caption'),
    toastEl: getEl('pattern-toast'),

    patternSelectorEl: getEl('pattern-selector'),
    patternCardsEl: getEl('pattern-cards'),

    telemetryTextarea: getEl('telemetry-code') as HTMLTextAreaElement,
    telemetryPanel: getEl('telemetry-panel'),
    telemetryTab: getEl('telemetry-tab') as HTMLButtonElement,
    evalStatusEl: getEl('eval-status'),

    sampleKnobEl: getEl('sample-knob'),
    // Fix: use querySelector<SVGGElement> instead of `as unknown as SVGGElement` double-cast
    knobNeedleGroup: document.querySelector<SVGGElement>('#knob-needle-group')!,
    knobValueEl: getEl('knob-value'),

    cpmKnobEl: getEl('cpm-knob'),
    cpmNeedleGroup: document.querySelector<SVGGElement>('#cpm-needle-group')!,
    cpmValueEl: getEl('cpm-value'),

    modeToggle,
    modeOptions: modeToggle.querySelectorAll<HTMLElement>('.mode-option'),

    playPauseBtn: getEl('play-pause-btn') as HTMLButtonElement,

    soundMenu,
    instrumentBtns: soundMenu.querySelectorAll<HTMLButtonElement>('[data-instrument]'),

    themeToggleBtn: getEl('theme-toggle') as HTMLButtonElement,

    audioOverlay: getEl('audio-overlay'),

    syncAudioBtn: getEl('sync-audio-btn'),

    tourEl: getEl('intro-tour'),
    tourSpot: getEl('intro-spotlight'),
    tourCounter: getEl('intro-step-counter'),
    tourText: getEl('intro-text'),
    tourGotIt: getEl('intro-got-it'),
    tourSkip: getEl('intro-skip'),

    dropOverlay: getEl('drop-overlay'),
    saveConfigBtn: getEl('save-config-btn'),
    loadConfigBtn: getEl('load-config-btn'),
    loadConfigInput: getEl('load-config-input') as HTMLInputElement,
  };
}
