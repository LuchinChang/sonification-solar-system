import { calculateLines, clamp } from '../engine';

// ── calculateLines ───────────────────────────────────────────────────────────

describe('calculateLines', () => {
  const cx = 500, cy = 400;
  const earthR = 300, venusR = 217;
  const earthPeriod = 365.25, venusPeriod = 224.7;
  const simYears = 8;

  it('returns exactly sampleRate lines', () => {
    const lines = calculateLines(cx, cy, 100, earthR, venusR, earthPeriod, venusPeriod, simYears);
    expect(lines).toHaveLength(100);
  });

  it('each line has valid p1 and p2 points', () => {
    const lines = calculateLines(cx, cy, 50, earthR, venusR, earthPeriod, venusPeriod, simYears);
    for (const line of lines) {
      expect(typeof line.p1.x).toBe('number');
      expect(typeof line.p1.y).toBe('number');
      expect(typeof line.p2.x).toBe('number');
      expect(typeof line.p2.y).toBe('number');
      expect(Number.isFinite(line.p1.x)).toBe(true);
      expect(Number.isFinite(line.p2.y)).toBe(true);
    }
  });

  it('Earth points lie on circle of radius earthR from center', () => {
    const lines = calculateLines(cx, cy, 200, earthR, venusR, earthPeriod, venusPeriod, simYears);
    for (const line of lines) {
      const dist = Math.hypot(line.p1.x - cx, line.p1.y - cy);
      expect(dist).toBeCloseTo(earthR, 5);
    }
  });

  it('Venus points lie on circle of radius venusR from center', () => {
    const lines = calculateLines(cx, cy, 200, earthR, venusR, earthPeriod, venusPeriod, simYears);
    for (const line of lines) {
      const dist = Math.hypot(line.p2.x - cx, line.p2.y - cy);
      expect(dist).toBeCloseTo(venusR, 5);
    }
  });
});

// ── clamp ────────────────────────────────────────────────────────────────────

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to lo when value is below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps to hi when value is above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('handles equal lo and hi', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});
