// src/__tests__/renderer.test.ts
//
// Tests for the rendering pipeline: dust particles and scene drawing.

import { describe, it, expect } from 'vitest';
import { initDust } from '../renderer';
import type { DustMote } from '../state';
import { DUST_COUNT } from '../state';

describe('initDust', () => {
  it('creates DUST_COUNT motes', () => {
    const motes: DustMote[] = [];
    initDust(motes);
    expect(motes.length).toBe(DUST_COUNT);
  });

  it('each mote has valid position in [0, 1]', () => {
    const motes: DustMote[] = [];
    initDust(motes);
    for (const m of motes) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(1);
    }
  });

  it('each mote has valid velocity', () => {
    const motes: DustMote[] = [];
    initDust(motes);
    for (const m of motes) {
      expect(Math.abs(m.vx)).toBeLessThan(0.001);
      expect(Math.abs(m.vy)).toBeLessThan(0.001);
    }
  });

  it('each mote has valid radius and alpha', () => {
    const motes: DustMote[] = [];
    initDust(motes);
    for (const m of motes) {
      expect(m.r).toBeGreaterThanOrEqual(0.8);
      expect(m.r).toBeLessThanOrEqual(2.3);
      expect(m.baseAlpha).toBeGreaterThanOrEqual(0.04);
      expect(m.baseAlpha).toBeLessThanOrEqual(0.12);
    }
  });

  it('appends to existing array', () => {
    const motes: DustMote[] = [
      { x: 0.5, y: 0.5, vx: 0, vy: 0, r: 1, baseAlpha: 0.05 },
    ];
    initDust(motes);
    expect(motes.length).toBe(1 + DUST_COUNT);
  });
});
