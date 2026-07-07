// src/__tests__/fifths.test.ts
import { describe, it, expect } from 'vitest';
import {
  fifthsSemitones, fifthsFrequency, radiusGain, radiusOctaveFactor, DEFAULT_F0,
} from '../fifths';

describe('fifthsSemitones', () => {
  it('steps a perfect fifth (7 semitones) per 30° sector', () => {
    expect(fifthsSemitones(0)).toBe(0);
    expect(fifthsSemitones(30)).toBe(7);
    expect(fifthsSemitones(60)).toBeCloseTo(2, 10);  // 14 mod 12
    expect(fifthsSemitones(90)).toBeCloseTo(9, 10);  // 21 mod 12
  });
  it('is continuous, not snapped', () => {
    expect(fifthsSemitones(15)).toBeCloseTo(3.5, 10);
    expect(fifthsSemitones(1)).toBeCloseTo(7 / 30, 10);
  });
  it('normalizes angles outside 0..360', () => {
    expect(fifthsSemitones(390)).toBeCloseTo(fifthsSemitones(30), 10);
    expect(fifthsSemitones(-330)).toBeCloseTo(fifthsSemitones(30), 10);
  });
});

describe('fifthsFrequency', () => {
  it('returns f0 at 0° and a fifth above at 30°', () => {
    expect(fifthsFrequency(0)).toBeCloseTo(DEFAULT_F0, 6);
    expect(fifthsFrequency(30)).toBeCloseTo(DEFAULT_F0 * Math.pow(2, 7 / 12), 6);
  });
  it('wraps into one octave by default, spans octaves when wrap=false', () => {
    const wrapped = fifthsFrequency(60);
    expect(wrapped).toBeGreaterThanOrEqual(DEFAULT_F0);
    expect(wrapped).toBeLessThan(DEFAULT_F0 * 2);
    expect(fifthsFrequency(60, DEFAULT_F0, false))
      .toBeCloseTo(DEFAULT_F0 * Math.pow(2, 14 / 12), 6);
  });
});

describe('radius helpers', () => {
  it('radiusGain: closer to the Sun is louder, floor 0.5', () => {
    expect(radiusGain(0)).toBe(1);
    expect(radiusGain(1)).toBeCloseTo(0.5, 10);
  });
  it('radiusOctaveFactor: mid radius is unity, extremes are ±1 octave', () => {
    expect(radiusOctaveFactor(0.5)).toBeCloseTo(1, 10);
    expect(radiusOctaveFactor(0)).toBeCloseTo(2, 10);
    expect(radiusOctaveFactor(1)).toBeCloseTo(0.5, 10);
  });
});
