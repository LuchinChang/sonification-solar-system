import { calculateCardioidLines } from '../engine';

// ── calculateCardioidLines ───────────────────────────────────────────────────

describe('calculateCardioidLines', () => {
  const cx = 0, cy = 0, R = 100;

  it('returns exactly N lines for N>0', () => {
    expect(calculateCardioidLines(cx, cy, 4, 1, R)).toHaveLength(4);
    expect(calculateCardioidLines(cx, cy, 100, 2, R)).toHaveLength(100);
    expect(calculateCardioidLines(cx, cy, 500, 7, R)).toHaveLength(500);
  });

  it('returns empty array when N <= 0', () => {
    expect(calculateCardioidLines(cx, cy, 0, 2, R)).toHaveLength(0);
    expect(calculateCardioidLines(cx, cy, -3, 2, R)).toHaveLength(0);
  });

  it('all rim points lie on the circle of radius R from (cx, cy)', () => {
    const lines = calculateCardioidLines(cx, cy, 50, 3, R);
    for (const ln of lines) {
      expect(Math.hypot(ln.p1.x - cx, ln.p1.y - cy)).toBeCloseTo(R, 5);
      expect(Math.hypot(ln.p2.x - cx, ln.p2.y - cy)).toBeCloseTo(R, 5);
    }
  });

  it('respects center offset', () => {
    const lines = calculateCardioidLines(123, 456, 8, 2, 50);
    for (const ln of lines) {
      expect(Math.hypot(ln.p1.x - 123, ln.p1.y - 456)).toBeCloseTo(50, 5);
    }
  });

  it('N=4, n=1 forms an inscribed square (each chord is a degenerate self-link)', () => {
    // n=1 means each i connects to (i*1)%N = i — chord is a point.
    const lines = calculateCardioidLines(cx, cy, 4, 1, R);
    for (const ln of lines) {
      expect(ln.p1.x).toBeCloseTo(ln.p2.x, 5);
      expect(ln.p1.y).toBeCloseTo(ln.p2.y, 5);
    }
    // Four expected positions: (R,0), (0,R), (-R,0), (0,-R)
    expect(lines[0].p1.x).toBeCloseTo(R, 5);
    expect(lines[0].p1.y).toBeCloseTo(0, 5);
    expect(lines[1].p1.x).toBeCloseTo(0, 5);
    expect(lines[1].p1.y).toBeCloseTo(R, 5);
    expect(lines[2].p1.x).toBeCloseTo(-R, 5);
    expect(lines[3].p1.y).toBeCloseTo(-R, 5);
  });

  it('N=10, n=2 produces classic cardioid index pairs i → (2i) mod 10', () => {
    const lines = calculateCardioidLines(cx, cy, 10, 2, R);
    // For each i, p1 should match angle 2π·i/10, p2 should match angle 2π·(2i%10)/10
    const angle = (i: number): number => (2 * Math.PI * i) / 10;
    for (let i = 0; i < 10; i++) {
      const ln = lines[i];
      const expectedP1 = { x: R * Math.cos(angle(i)),     y: R * Math.sin(angle(i))     };
      const expectedP2 = { x: R * Math.cos(angle((i * 2) % 10)), y: R * Math.sin(angle((i * 2) % 10)) };
      expect(ln.p1.x).toBeCloseTo(expectedP1.x, 5);
      expect(ln.p1.y).toBeCloseTo(expectedP1.y, 5);
      expect(ln.p2.x).toBeCloseTo(expectedP2.x, 5);
      expect(ln.p2.y).toBeCloseTo(expectedP2.y, 5);
    }
  });

  it('N=10, n=3 produces nephroid index pairs i → (3i) mod 10', () => {
    const lines = calculateCardioidLines(cx, cy, 10, 3, R);
    const expectedTargets = [0, 3, 6, 9, 2, 5, 8, 1, 4, 7];
    for (let i = 0; i < 10; i++) {
      const target = expectedTargets[i];
      const angleT = (2 * Math.PI * target) / 10;
      expect(lines[i].p2.x).toBeCloseTo(R * Math.cos(angleT), 5);
      expect(lines[i].p2.y).toBeCloseTo(R * Math.sin(angleT), 5);
    }
  });

  it('n=N collapses every chord to its source point (degenerate but stable)', () => {
    const lines = calculateCardioidLines(cx, cy, 10, 10, R);
    // n=10 mod 10 = 0, so (i*0)%10 = 0 for every i → every chord ends at point 0
    for (const ln of lines) {
      expect(ln.p2.x).toBeCloseTo(R, 5);
      expect(ln.p2.y).toBeCloseTo(0, 5);
    }
  });

  it('n > N wraps via mod (n=12 with N=10 == n=2)', () => {
    const a = calculateCardioidLines(cx, cy, 10, 12, R);
    const b = calculateCardioidLines(cx, cy, 10, 2, R);
    for (let i = 0; i < 10; i++) {
      expect(a[i].p2.x).toBeCloseTo(b[i].p2.x, 5);
      expect(a[i].p2.y).toBeCloseTo(b[i].p2.y, 5);
    }
  });

  it('handles negative n via positive mod', () => {
    // n=-2 with N=10 should equal n=8 (since -2 mod 10 = 8)
    const a = calculateCardioidLines(cx, cy, 10, -2, R);
    const b = calculateCardioidLines(cx, cy, 10, 8, R);
    for (let i = 0; i < 10; i++) {
      expect(a[i].p2.x).toBeCloseTo(b[i].p2.x, 5);
      expect(a[i].p2.y).toBeCloseTo(b[i].p2.y, 5);
    }
  });

  it('N=1 returns a single self-link at (cx+R, cy)', () => {
    const lines = calculateCardioidLines(cx, cy, 1, 5, R);
    expect(lines).toHaveLength(1);
    expect(lines[0].p1.x).toBeCloseTo(R, 5);
    expect(lines[0].p1.y).toBeCloseTo(0, 5);
    expect(lines[0].p2.x).toBeCloseTo(R, 5);
    expect(lines[0].p2.y).toBeCloseTo(0, 5);
  });
});
