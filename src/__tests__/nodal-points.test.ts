// src/__tests__/nodal-points.test.ts
import { describe, it, expect } from 'vitest';
import {
  segmentIntersection, cyclicLocalMaxima, findNodalPoints,
} from '../nodal-points';
import { computePatternLines, PATTERNS } from '../patterns';

const seg = (x1: number, y1: number, x2: number, y2: number) =>
  ({ p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });

describe('segmentIntersection', () => {
  it('finds the crossing of two crossing segments', () => {
    const p = segmentIntersection(seg(0, 0, 10, 10), seg(0, 10, 10, 0));
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(5, 6);
    expect(p!.y).toBeCloseTo(5, 6);
  });
  it('returns null for parallel and for non-overlapping segments', () => {
    expect(segmentIntersection(seg(0, 0, 10, 0), seg(0, 5, 10, 5))).toBeNull();
    expect(segmentIntersection(seg(0, 0, 1, 1), seg(5, 0, 6, -1))).toBeNull();
  });
});

describe('cyclicLocalMaxima', () => {
  it('finds strict maxima, including across the wrap point', () => {
    expect(cyclicLocalMaxima([1, 3, 2, 1, 5, 1])).toEqual([1, 4]);
    expect(cyclicLocalMaxima([9, 1, 2, 3, 1, 2])).toEqual([0, 3]); // 9 beats both cyclic neighbours
  });
  it('ignores plateaus', () => {
    expect(cyclicLocalMaxima([1, 4, 4, 1, 0, 0])).toEqual([]);
  });
});

describe('findNodalPoints on the Pentagram of Venus', () => {
  const venusEarth = PATTERNS.find(p => p.id === 'venus-earth')!;
  const SIZE = 280;
  const lines = computePatternLines(venusEarth, SIZE, 1200);
  const pts = findNodalPoints(lines, SIZE / 2, SIZE / 2, venusEarth.petals, SIZE);

  it('finds exactly 5 nodal points (one per symmetry lobe)', () => {
    expect(pts.length).toBe(5);
  });
  it('spaces them ~72° apart around the Sun', () => {
    const angles = pts.map(p => p.angleDeg).sort((a, b) => a - b);
    for (let i = 0; i < 5; i++) {
      const next = angles[(i + 1) % 5] + (i === 4 ? 360 : 0);
      expect(next - angles[i]).toBeGreaterThan(72 - 8);
      expect(next - angles[i]).toBeLessThan(72 + 8);
    }
  });
  it('puts them on one ring (radii within 25% — real orbits are eccentric)', () => {
    // The pattern uses true JPL elliptical orbits, so the pentagram's inner
    // ring is honestly lopsided: measured spread is ~1.20 (21.4→25.6px),
    // stable across sampling densities 800/1200/2000.
    const radii = pts.map(p => p.radius);
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.25);
  });
});
