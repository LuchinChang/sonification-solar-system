// src/__tests__/waveform-viz.test.ts
//
// Pure math for the playground's waveform display: one voice's two partials
// and their combination, sampled over one closed fundamental period.
import { describe, it, expect } from 'vitest';
import { computeWaveSamples } from '../waveform-viz';
import { DEFAULT_SETTINGS } from '../playground-settings';

const RES = { innerOrbits: 13, outerOrbits: 8 }; // Venus-Earth pentagram

describe('computeWaveSamples', () => {
  it('returns three equal-length traces', () => {
    const w = computeWaveSamples(DEFAULT_SETTINGS, RES, 256);
    expect(w.partial1.length).toBe(256);
    expect(w.partial2.length).toBe(256);
    expect(w.combined.length).toBe(256);
  });

  it('partials are unit sines closing over the fundamental period', () => {
    const w = computeWaveSamples(DEFAULT_SETTINGS, RES, 512);
    // partial 1 = harmonic q (outer=8): starts at 0, max amplitude 1
    expect(w.partial1[0]).toBeCloseTo(0, 6);
    expect(Math.max(...w.partial1)).toBeGreaterThan(0.99);
    expect(Math.min(...w.partial1)).toBeLessThan(-0.99);
  });

  it('add operator mixes by balance and normalizes to |1|', () => {
    const w = computeWaveSamples(
      { ...DEFAULT_SETTINGS, operator: 'add', balance: 0.5 }, RES, 512);
    const peak = Math.max(...w.combined.map(Math.abs));
    expect(peak).toBeCloseTo(1, 6);
    // balance 0 → combined is exactly partial 1 (normalized)
    const w0 = computeWaveSamples(
      { ...DEFAULT_SETTINGS, operator: 'add', balance: 0 }, RES, 128);
    for (let i = 0; i < 128; i++) {
      expect(w0.combined[i]).toBeCloseTo(w0.partial1[i], 6);
    }
  });

  it('ring operator is the normalized product of the partials', () => {
    const w = computeWaveSamples({ ...DEFAULT_SETTINGS, operator: 'ring' }, RES, 128);
    const raw = w.partial1.map((v, i) => v * w.partial2[i]);
    const peak = Math.max(...raw.map(Math.abs));
    for (let i = 0; i < 128; i++) {
      expect(w.combined[i]).toBeCloseTo(raw[i] / peak, 6);
    }
  });

  it('fm with index 0 collapses to the pure carrier', () => {
    const w = computeWaveSamples(
      { ...DEFAULT_SETTINGS, operator: 'fm', fmIndex: 0 }, RES, 128);
    for (let i = 0; i < 128; i++) {
      expect(w.combined[i]).toBeCloseTo(w.partial1[i], 6);
    }
  });

  it('phase knob shifts partial 2', () => {
    const a = computeWaveSamples({ ...DEFAULT_SETTINGS, phaseDeg: 0 }, RES, 128);
    const b = computeWaveSamples({ ...DEFAULT_SETTINGS, phaseDeg: 90 }, RES, 128);
    expect(a.partial2[0]).toBeCloseTo(0, 6);
    expect(b.partial2[0]).toBeCloseTo(1, 6); // sin(x+90°) = cos → 1 at t=0
  });

  it('free ratio mode uses the free ratio, resonance mode the m:k integers', () => {
    const free = computeWaveSamples(
      { ...DEFAULT_SETTINGS, ratioMode: 'free', freeRatio: 2 }, RES, 128);
    expect(free.ratioLabel).toBe('×2');
    const res = computeWaveSamples(DEFAULT_SETTINGS, RES, 128);
    expect(res.ratioLabel).toBe('13:8');
  });

  it('caps display density for extreme resonances', () => {
    const extreme = computeWaveSamples(
      DEFAULT_SETTINGS, { innerOrbits: 411, outerOrbits: 100 }, 128);
    expect(extreme.cyclesShown).toBeLessThanOrEqual(24);
    expect(Math.max(...extreme.combined.map(Math.abs))).toBeCloseTo(1, 6);
  });
});
