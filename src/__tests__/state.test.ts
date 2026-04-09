// src/__tests__/state.test.ts
//
// Tests for centralized application state: factory defaults & constant ranges.

import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  MIN_SAMPLES, MAX_SAMPLES,
  MIN_CPM, MAX_CPM,
  MIN_SHAPE_SIZE, MAX_SHAPE_SIZE,
  DUST_COUNT,
  CANVAS_THEMES,
  sunPos,
} from '../state';

describe('createInitialState', () => {
  it('returns an object with all required fields', () => {
    const s = createInitialState();
    expect(s).toBeDefined();
    expect(s.currentPattern).toBeDefined();
    expect(s.shapes).toEqual([]);
    expect(s.activeShape).toBeNull();
    expect(s.strudelRepl).toBeNull();
    expect(s.audioInitialized).toBe(false);
    expect(s.isPlaying).toBe(false);
    expect(s.dustMotes).toEqual([]);
    expect(s.flashCooldowns).toBeInstanceOf(Map);
  });

  it('defaults to first pattern (Venus-Earth)', () => {
    const s = createInitialState();
    expect(s.currentPattern.id).toBe('venus-earth');
    expect(s.currentSimYears).toBe(8);
  });

  it('initialises orbital radii from pattern AU values', () => {
    const s = createInitialState();
    // Venus AU = 0.723, Earth AU = 1.0; scale = 300
    expect(s.currentInnerR).toBeCloseTo(0.723 * 300, 1);
    expect(s.currentOuterR).toBeCloseTo(1.0 * 300, 1);
    expect(s.orbitalMaxRadius).toBeCloseTo(300 * 1.05, 1);
  });

  it('defaults to constant-time playback mode', () => {
    const s = createInitialState();
    expect(s.playbackMode).toBe('constant-time');
  });

  it('defaults CPM to 10', () => {
    const s = createInitialState();
    expect(s.cpm).toBe(10);
  });

  it('defaults sample rate to 500', () => {
    const s = createInitialState();
    expect(s.sampleRate).toBe(500);
  });

  it('defaults theme to light', () => {
    const s = createInitialState();
    expect(s.currentTheme).toBe('light');
  });

  it('state is mutable (not frozen)', () => {
    const s = createInitialState();
    s.cpm = 42;
    expect(s.cpm).toBe(42);
    s.isPlaying = true;
    expect(s.isPlaying).toBe(true);
  });
});

describe('constants', () => {
  it('sample rate range is valid', () => {
    expect(MIN_SAMPLES).toBeLessThan(MAX_SAMPLES);
    expect(MIN_SAMPLES).toBeGreaterThan(0);
  });

  it('CPM range is valid', () => {
    expect(MIN_CPM).toBeLessThan(MAX_CPM);
    expect(MIN_CPM).toBeGreaterThan(0);
  });

  it('shape size range is valid', () => {
    expect(MIN_SHAPE_SIZE).toBeLessThan(MAX_SHAPE_SIZE);
    expect(MIN_SHAPE_SIZE).toBeGreaterThan(0);
  });

  it('DUST_COUNT is a positive integer', () => {
    expect(DUST_COUNT).toBeGreaterThan(0);
    expect(Number.isInteger(DUST_COUNT)).toBe(true);
  });
});

describe('CANVAS_THEMES', () => {
  it('provides dark and light theme colours', () => {
    expect(CANVAS_THEMES.dark).toBeDefined();
    expect(CANVAS_THEMES.light).toBeDefined();
  });

  it('each theme has all required colour fields', () => {
    for (const theme of ['dark', 'light'] as const) {
      const ct = CANVAS_THEMES[theme];
      expect(ct.bg).toBeDefined();
      expect(ct.sunGlow0).toBeDefined();
      expect(ct.sunGlow1).toBeDefined();
      expect(ct.sunGlow2).toBeDefined();
      expect(ct.sunCore).toBeDefined();
      expect(ct.linkLine).toBeDefined();
    }
  });

  it('dark and light themes have different backgrounds', () => {
    expect(CANVAS_THEMES.dark.bg).not.toBe(CANVAS_THEMES.light.bg);
  });
});

describe('sunPos', () => {
  it('returns canvas center', () => {
    const mockCanvas = { width: 800, height: 600 } as HTMLCanvasElement;
    const pos = sunPos(mockCanvas);
    expect(pos.x).toBe(400);
    expect(pos.y).toBe(300);
  });
});
