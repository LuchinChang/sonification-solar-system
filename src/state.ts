// src/state.ts
//
// Centralized application state — replaces ~30 module-scope mutable variables
// that were previously scattered across main.ts. Every module imports AppState
// instead of closing over global lets.

import type { Point } from './geometry';
import type { CanvasShape, PlaybackMode } from './shapes';
import type { PlanetaryPattern } from './patterns';
import { PATTERNS } from './patterns';

// ── Constants ────────────────────────────────────────────────────────────────

export const MIN_SAMPLES     = 10;
export const MAX_SAMPLES     = 2000;
export const MIN_CPM         = 5;
export const MAX_CPM         = 100;
export const MIN_SHAPE_SIZE  = 20;
export const MAX_SHAPE_SIZE  = 400;
export const DUST_COUNT      = 40;
export const KNOB_SENSITIVITY = 5;
export const CPM_SENSITIVITY  = 2;
export const DRAG_THRESHOLD   = 5;
export const FLASH_COOLDOWN_MS = 80;

// ── Theme types ──────────────────────────────────────────────────────────────

export type AppTheme = 'dark' | 'light';

export interface CanvasThemeColors {
  bg: string;
  sunGlow0: string;
  sunGlow1: string;
  sunGlow2: string;
  sunCore: string;
  linkLine: string;
}

export const CANVAS_THEMES: Record<AppTheme, CanvasThemeColors> = {
  dark: {
    bg:       '#120F0E',
    sunGlow0: 'rgba(255, 170, 60, 0.85)',
    sunGlow1: 'rgba(230, 100, 30, 0.35)',
    sunGlow2: 'rgba(180,  60, 10, 0)',
    sunCore:  '#FFA030',
    linkLine: 'rgba(194, 118, 46, 0.2)',
  },
  light: {
    bg:       '#F0EDE6',
    sunGlow0: 'rgba(255, 180, 50, 0.80)',
    sunGlow1: 'rgba(240, 120, 20, 0.30)',
    sunGlow2: 'rgba(200,  80, 10, 0)',
    sunCore:  '#F08010',
    linkLine: 'rgba(92, 58, 33, 0.2)',
  },
};

// ── Strudel REPL interface ───────────────────────────────────────────────────
// Replaces the `any` type that was previously used for strudelRepl.

export interface StrudelRepl {
  evaluate(code: string, autostart?: boolean): Promise<void>;
  start(): void;
  stop(): void;
  setCps(cps: number): void;
}

// ── Link line type alias ─────────────────────────────────────────────────────

export type LinkLine = { p1: Point; p2: Point };

// ── Dust mote type ───────────────────────────────────────────────────────────

export interface DustMote {
  x: number;      // 0..1 normalised position
  y: number;
  vx: number;     // normalised velocity
  vy: number;
  r: number;      // radius in px
  baseAlpha: number;
}

// ── Application state ────────────────────────────────────────────────────────

export interface AppState {
  // Orbital engine
  currentPattern: PlanetaryPattern;
  currentAuScale: number;
  currentOuterR: number;
  currentInnerR: number;
  currentOuterPeriod: number;
  currentInnerPeriod: number;
  currentSimYears: number;
  orbitalMaxRadius: number;
  sampleRate: number;
  linkLines: LinkLine[];
  fullLinkLines: LinkLine[];

  // Draw animation
  drawAnimActive: boolean;
  drawAnimStartTime: number;
  drawAnimDurationMs: number;
  drawAnimProgress: number;
  drawLineCount: number;
  currentCaptionText: string;
  captionTimeoutId: ReturnType<typeof setTimeout> | null;

  // Shapes
  shapes: CanvasShape[];
  activeShape: CanvasShape | null;

  // Sequencer
  cpm: number;
  playbackMode: PlaybackMode;
  isPlaying: boolean;
  lastFrameTime: number;

  // (Per-shape sweeper AC-clock sync lives on each CanvasShape — see shapes.ts)

  // Theme
  currentTheme: AppTheme;

  // Audio
  strudelRepl: StrudelRepl | null;
  audioInitialized: boolean;

  // Dust particles
  dustMotes: DustMote[];

  // Drag state
  knobDragging: boolean;
  knobDragStartY: number;
  knobDragStartRate: number;
  cpmDragging: boolean;
  cpmDragStartY: number;
  cpmDragStartCPM: number;
  shapeDragTarget: CanvasShape | null;
  shapeDragOffset: { x: number; y: number };
  didDragShape: boolean;
  mouseDownPos: { x: number; y: number };

  // Tour
  tourActive: boolean;
  tourStepIdx: number;
  tourLiftedEl: HTMLElement | null;

  // Flash cooldowns
  flashCooldowns: Map<number, number>;
}

export function createInitialState(): AppState {
  const pattern = PATTERNS[0];
  const auScale = 300;
  const outerR  = Math.max(pattern.au1, pattern.au2) * auScale;
  const innerR  = Math.min(pattern.au1, pattern.au2) * auScale;

  return {
    // Orbital engine
    currentPattern: pattern,
    currentAuScale: auScale,
    currentOuterR: outerR,
    currentInnerR: innerR,
    currentOuterPeriod: 365.25,
    currentInnerPeriod: 224.7,
    currentSimYears: 8,
    orbitalMaxRadius: outerR * 1.05,
    sampleRate: 500,
    linkLines: [],
    fullLinkLines: [],

    // Draw animation
    drawAnimActive: false,
    drawAnimStartTime: 0,
    drawAnimDurationMs: 0,
    drawAnimProgress: 0,
    drawLineCount: 0,
    currentCaptionText: '',
    captionTimeoutId: null,

    // Shapes
    shapes: [],
    activeShape: null,

    // Sequencer
    cpm: 10,
    playbackMode: 'constant-time',
    isPlaying: false,
    lastFrameTime: 0,

    // Theme
    currentTheme: 'light',

    // Audio
    strudelRepl: null,
    audioInitialized: false,

    // Dust particles (deferred — populated by initDust())
    dustMotes: [],

    // Drag state
    knobDragging: false,
    knobDragStartY: 0,
    knobDragStartRate: 500,
    cpmDragging: false,
    cpmDragStartY: 0,
    cpmDragStartCPM: 10,
    shapeDragTarget: null,
    shapeDragOffset: { x: 0, y: 0 },
    didDragShape: false,
    mouseDownPos: { x: 0, y: 0 },

    // Tour
    tourActive: false,
    tourStepIdx: 0,
    tourLiftedEl: null,

    // Flash cooldowns
    flashCooldowns: new Map(),
  };
}

/** Compute the Sun's position (canvas center). */
export function sunPos(canvas: HTMLCanvasElement): { x: number; y: number } {
  return { x: canvas.width / 2, y: canvas.height / 2 };
}
