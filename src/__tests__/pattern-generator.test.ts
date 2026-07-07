// src/__tests__/pattern-generator.test.ts
//
// Hybrid pattern model (ADR 0002): any valid inner/outer pair yields a
// pattern — curated pairs return the authored catalogue entry, everything
// else is computed from JPL orbital elements.

import { describe, it, expect } from 'vitest';
import {
  PLANET_ORDER, periodDays, computeResonance,
  getPatternForPair, pairId, patternFromId,
} from '../pattern-generator';
import { PATTERNS } from '../patterns';

describe('periodDays', () => {
  it('derives sidereal periods from JPL LDot (deg/century)', () => {
    expect(periodDays('Mercury')).toBeCloseTo(87.97, 1);
    expect(periodDays('Earth')).toBeCloseTo(365.25, 0);
    expect(periodDays('Neptune')).toBeCloseTo(60190, -2);
  });
});

describe('computeResonance', () => {
  it('finds the Venus-Earth 13:8 resonance (5 petals over 8 years)', () => {
    const r = computeResonance(periodDays('Venus'), periodDays('Earth'));
    expect(r.outerOrbits).toBe(8);
    expect(r.innerOrbits).toBe(13);
    expect(r.petals).toBe(5);
    expect(r.simYears).toBeCloseTo(8, 0);
  });

  it('finds the Earth-Mars 15:8 resonance (7 petals ≈ curated Flower of Mars)', () => {
    const r = computeResonance(periodDays('Earth'), periodDays('Mars'));
    expect(r.petals).toBe(7);
    expect(r.simYears).toBeCloseTo(15, 0);
  });

  it('bounds the search by watchable duration — Mercury-Neptune runs one truthful Neptune orbit', () => {
    const r = computeResonance(periodDays('Mercury'), periodDays('Neptune'));
    expect(r.outerOrbits).toBe(1);
    expect(r.simYears).toBeCloseTo(164.8, 0);
    expect(r.petals).toBe(r.innerOrbits - 1);
  });

  it('computed Jupiter-Uranus lands on the curated answer (one Uranus orbit, 6 petals)', () => {
    const r = computeResonance(periodDays('Jupiter'), periodDays('Uranus'));
    expect(r.outerOrbits).toBe(1);
    expect(r.petals).toBe(6);
    expect(r.simYears).toBeCloseTo(84, 0);
  });
});

describe('getPatternForPair', () => {
  it('returns the curated catalogue object for a curated pair', () => {
    const p = getPatternForPair('Venus', 'Earth');
    expect(p).toBe(PATTERNS.find(x => x.id === 'venus-earth'));
  });

  it('computes a pattern for an uncurated pair', () => {
    const p = getPatternForPair('Mars', 'Saturn');
    expect(p.id).toBe('pair-mars-saturn');
    expect(p.planet1).toBe('Mars');
    expect(p.planet2).toBe('Saturn');
    expect(p.au1).toBeCloseTo(1.524, 2);
    expect(p.au2).toBeCloseTo(9.537, 2);
    expect(p.simYears).toBeGreaterThan(0);
    expect(p.petals).toBeGreaterThan(0);
    expect(p.captions.length).toBeGreaterThanOrEqual(4);
    expect(p.captions[0].atProgress).toBe(0);
  });

  it('rejects a pair where the "inner" planet is not inside the outer orbit', () => {
    expect(() => getPatternForPair('Earth', 'Venus')).toThrow();
    expect(() => getPatternForPair('Earth', 'Earth')).toThrow();
  });

  it('rejects unknown planet names', () => {
    expect(() => getPatternForPair('Pluto', 'Neptune')).toThrow();
  });
});

describe('patternFromId', () => {
  it('resolves catalogue ids', () => {
    expect(patternFromId('venus-earth')?.name).toBe('Pentagram of Venus');
    expect(patternFromId('cardioid')?.kind).toBe('cardioid');
  });

  it('round-trips computed pair ids (config-snapshot restore path)', () => {
    const original = getPatternForPair('Mercury', 'Jupiter');
    const restored = patternFromId(pairId('Mercury', 'Jupiter'));
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(original.id);
    expect(restored!.simYears).toBe(original.simYears);
  });

  it('returns null for garbage ids', () => {
    expect(patternFromId('pair-foo-bar')).toBeNull();
    expect(patternFromId('nope')).toBeNull();
  });
});

describe('PLANET_ORDER', () => {
  it('lists all 8 planets sorted by semi-major axis', () => {
    expect(PLANET_ORDER).toEqual([
      'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
    ]);
  });
});
