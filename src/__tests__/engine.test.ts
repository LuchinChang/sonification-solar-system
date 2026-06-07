import {
  calculateLines,
  clamp,
  calculateMoonHexagonLines,
  calculateMoonEclipses,
  SOLAR_SYNODIC_ROTATION_DAYS,
} from '../engine';

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

// ── Moon hexagon (stroboscopic) ──────────────────────────────────────────────

describe('calculateMoonHexagonLines', () => {
  const cx = 500, cy = 400;
  const a = 384.4;            // Moon semi-major axis (px)
  const e = 0.0549;
  const anomMonth = 27.5545;  // anomalistic month (days)
  const apsidalDays = 8.85 * 365.25;

  it('returns exactly sampleCount segments', () => {
    const lines = calculateMoonHexagonLines(cx, cy, 588, a, e, anomMonth, apsidalDays);
    expect(lines).toHaveLength(588);
  });

  it('every vertex lies within the Moon distance band [a(1−e), a(1+e)]', () => {
    const lines = calculateMoonHexagonLines(cx, cy, 588, a, e, anomMonth, apsidalDays);
    const lo = a * (1 - e) - 1e-6;
    const hi = a * (1 + e) + 1e-6;
    for (const line of lines) {
      const r = Math.hypot(line.p2.x - cx, line.p2.y - cy);
      expect(r).toBeGreaterThanOrEqual(lo);
      expect(r).toBeLessThanOrEqual(hi);
    }
  });

  it('exhibits six-fold symmetry: ~6 distance-maxima over one ~588-sample hexagon', () => {
    const lines = calculateMoonHexagonLines(cx, cy, 588, a, e, anomMonth, apsidalDays);
    // Reconstruct the vertex radii: first p1, then each p2.
    const radii = [Math.hypot(lines[0].p1.x - cx, lines[0].p1.y - cy)];
    for (const line of lines) radii.push(Math.hypot(line.p2.x - cx, line.p2.y - cy));
    let maxima = 0;
    for (let i = 1; i < radii.length - 1; i++) {
      if (radii[i] > radii[i - 1] && radii[i] > radii[i + 1]) maxima++;
    }
    expect(maxima).toBeGreaterThanOrEqual(5);
    expect(maxima).toBeLessThanOrEqual(7);
  });

  it('timing jitter keeps count + distance band but adds edge loops', () => {
    const countMaxima = (ls: { p1: { x: number; y: number }; p2: { x: number; y: number } }[]) => {
      const r = [Math.hypot(ls[0].p1.x - cx, ls[0].p1.y - cy)];
      for (const l of ls) r.push(Math.hypot(l.p2.x - cx, l.p2.y - cy));
      let m = 0;
      for (let i = 1; i < r.length - 1; i++) if (r[i] > r[i - 1] && r[i] > r[i + 1]) m++;
      return m;
    };
    const clean = calculateMoonHexagonLines(cx, cy, 588, a, e, anomMonth, apsidalDays);
    const jittered = calculateMoonHexagonLines(
      cx, cy, 588, a, e, anomMonth, apsidalDays, SOLAR_SYNODIC_ROTATION_DAYS, 0.45, 109.1,
    );
    expect(jittered).toHaveLength(588); // same segment count → no audio-cost change
    const lo = a * (1 - e) - 1e-6, hi = a * (1 + e) + 1e-6;
    for (const l of jittered) {
      const r = Math.hypot(l.p2.x - cx, l.p2.y - cy);
      expect(r).toBeGreaterThanOrEqual(lo);
      expect(r).toBeLessThanOrEqual(hi);
    }
    // Loops show up as extra distance-maxima beyond the clean hexagon's ~6.
    expect(countMaxima(jittered)).toBeGreaterThan(countMaxima(clean));
  });
});

describe('calculateMoonEclipses', () => {
  const cx = 500, cy = 400;
  const a = 384.4;
  const e = 0.0549;
  const anomMonth = 27.5545;
  const apsidalDays = 8.85 * 365.25;
  const sunYear = 365.2422;
  const totalDays = 588 * SOLAR_SYNODIC_ROTATION_DAYS; // ~43.9 years

  it('produces a sparse set of eclipses (a few per year, not every syzygy)', () => {
    const eclipses = calculateMoonEclipses(cx, cy, totalDays, a, e, anomMonth, apsidalDays, sunYear);
    const years = totalDays / 365.25;
    const perYear = eclipses.length / years;
    // Real eclipse rate is a handful per year — far below the ~25 syzygies/yr.
    expect(perYear).toBeGreaterThan(1);
    expect(perYear).toBeLessThan(8);
  });

  it('every eclipse lies within the Moon distance band and is solar or lunar', () => {
    const eclipses = calculateMoonEclipses(cx, cy, totalDays, a, e, anomMonth, apsidalDays, sunYear);
    expect(eclipses.length).toBeGreaterThan(0);
    const lo = a * (1 - e) - 1e-6, hi = a * (1 + e) + 1e-6;
    for (const d of eclipses) {
      const r = Math.hypot(d.x - cx, d.y - cy);
      expect(r).toBeGreaterThanOrEqual(lo);
      expect(r).toBeLessThanOrEqual(hi);
      expect(['solar', 'lunar']).toContain(d.kind);
      expect(d.atProgress).toBeGreaterThanOrEqual(0);
      expect(d.atProgress).toBeLessThanOrEqual(1);
    }
  });

  it('a tighter latitude limit yields fewer eclipses', () => {
    const wide = calculateMoonEclipses(cx, cy, totalDays, a, e, anomMonth, apsidalDays, sunYear, 18.6, 1.5);
    const tight = calculateMoonEclipses(cx, cy, totalDays, a, e, anomMonth, apsidalDays, sunYear, 18.6, 0.4);
    expect(tight.length).toBeLessThan(wide.length);
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
