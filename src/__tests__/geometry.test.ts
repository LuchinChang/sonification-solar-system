import { getLineCircleIntersections, getRaySegmentDist, pointToSegmentDist } from '../geometry';

// ── getLineCircleIntersections ────────────────────────────────────────────────

describe('getLineCircleIntersections', () => {
  it('returns 2 points when line passes through circle center', () => {
    // Horizontal line through center of circle at origin, radius 50
    const pts = getLineCircleIntersections(
      { x: -100, y: 0 }, { x: 100, y: 0 },
      0, 0, 50,
    );
    expect(pts).toHaveLength(2);
    expect(pts[0].x).toBeCloseTo(-50);
    expect(pts[0].y).toBeCloseTo(0);
    expect(pts[1].x).toBeCloseTo(50);
    expect(pts[1].y).toBeCloseTo(0);
  });

  it('returns 1 point for a tangent line', () => {
    // Horizontal line tangent to top of circle at origin, radius 50
    const pts = getLineCircleIntersections(
      { x: -100, y: -50 }, { x: 100, y: -50 },
      0, 0, 50,
    );
    // Tangent → discriminant ≈ 0, may produce 1 or 2 very close points
    expect(pts.length).toBeGreaterThanOrEqual(1);
    for (const p of pts) {
      expect(p.y).toBeCloseTo(-50);
    }
  });

  it('returns 0 points when line misses circle entirely', () => {
    const pts = getLineCircleIntersections(
      { x: -100, y: 200 }, { x: 100, y: 200 },
      0, 0, 50,
    );
    expect(pts).toHaveLength(0);
  });

  it('returns 1 point when segment ends inside circle', () => {
    // Segment from outside to center — enters circle but ends at center
    const pts = getLineCircleIntersections(
      { x: -100, y: 0 }, { x: 0, y: 0 },
      0, 0, 50,
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].x).toBeCloseTo(-50);
  });

  it('returns 0 points when segment is fully inside circle', () => {
    const pts = getLineCircleIntersections(
      { x: -10, y: 0 }, { x: 10, y: 0 },
      0, 0, 50,
    );
    expect(pts).toHaveLength(0);
  });
});

// ── getRaySegmentDist ─────────────────────────────────────────────────────────

describe('getRaySegmentDist', () => {
  it('returns correct distance for ray hitting perpendicular segment', () => {
    // Ray from origin pointing right (angle=0), segment at x=30 vertical
    const d = getRaySegmentDist(
      { x: 0, y: 0 }, 0,
      { x: 30, y: -10 }, { x: 30, y: 10 },
    );
    expect(d).toBeCloseTo(30);
  });

  it('returns null for parallel ray', () => {
    // Horizontal ray, horizontal segment
    const d = getRaySegmentDist(
      { x: 0, y: 0 }, 0,
      { x: 10, y: 5 }, { x: 50, y: 5 },
    );
    expect(d).toBeNull();
  });

  it('returns null when ray points away from segment', () => {
    // Ray pointing left (angle=π), segment to the right
    const d = getRaySegmentDist(
      { x: 0, y: 0 }, Math.PI,
      { x: 30, y: -10 }, { x: 30, y: 10 },
    );
    expect(d).toBeNull();
  });

  it('returns correct distance when ray hits segment endpoint', () => {
    // Ray from origin pointing up-right at 45°, segment endpoint at (10, 10)
    const d = getRaySegmentDist(
      { x: 0, y: 0 }, Math.PI / 4,
      { x: 10, y: 10 }, { x: 20, y: 10 },
    );
    expect(d).toBeCloseTo(Math.hypot(10, 10));
  });
});

// ── pointToSegmentDist ────────────────────────────────────────────────────────

describe('pointToSegmentDist', () => {
  it('returns perpendicular distance when point projects onto segment interior', () => {
    // Point at (5, 3), segment from (0, 0) to (10, 0) → distance = 3
    expect(pointToSegmentDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('returns distance to nearest endpoint when point projects outside segment', () => {
    // Point at (15, 0), segment from (0, 0) to (10, 0) → distance = 5
    expect(pointToSegmentDist(15, 0, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('returns distance to the point for zero-length segment', () => {
    expect(pointToSegmentDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });
});
