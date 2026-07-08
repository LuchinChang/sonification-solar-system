// src/__tests__/nodal-chord.test.ts
//
// Pure voice computation only — the WebAudio graph itself is E2E-verified
// (ADR 0003: raw-WebAudio synthesis is selector-local and browser-only).
import { describe, it, expect } from 'vitest';
import { chordVoices } from '../nodal-chord';
import { DEFAULT_SETTINGS } from '../playground-settings';
import type { NodalPoint } from '../nodal-points';

const pt = (angleDeg: number, radius: number): NodalPoint =>
  ({ x: 0, y: 0, angleDeg, radius, nodality: 1 });

describe('chordVoices', () => {
  it('emits one voice per nodal point with resonance-locked ratio', () => {
    const v = chordVoices([pt(0, 50), pt(72, 50)], DEFAULT_SETTINGS,
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(v.length).toBe(2);
    expect(v[0].freq).toBeCloseTo(DEFAULT_SETTINGS.f0, 4);
    expect(v[0].ratio).toBeCloseTo(13 / 8, 10);
    expect(v[0].gain).toBe(1);
  });
  it('uses the free ratio when ratioMode is free', () => {
    const v = chordVoices([pt(0, 50)],
      { ...DEFAULT_SETTINGS, ratioMode: 'free', freeRatio: 2.5 },
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(v[0].ratio).toBe(2.5);
  });
  it('keeps wrapped pitches inside one octave of f0', () => {
    const v = chordVoices([pt(300, 50)], DEFAULT_SETTINGS,
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(v[0].freq).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.f0);
    expect(v[0].freq).toBeLessThan(DEFAULT_SETTINGS.f0 * 2);
  });
  it('applies radius→gain and radius→octave mappings', () => {
    const gainV = chordVoices([pt(0, 100)],
      { ...DEFAULT_SETTINGS, radiusMapping: 'gain' },
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(gainV[0].gain).toBeCloseTo(0.5, 6);
    const octV = chordVoices([pt(0, 0)],
      { ...DEFAULT_SETTINGS, radiusMapping: 'octave' },
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(octV[0].freq).toBeCloseTo(DEFAULT_SETTINGS.f0 * 2, 4);
  });
});
