import { CanvasShape, isDrum, RHYTHM_STEPS } from '../shapes';
import type { Point } from '../geometry';

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Create link lines that cross through a shape at the origin. */
function makeCrossLines(cx: number, cy: number, radius: number): { p1: Point; p2: Point }[] {
  // 4 lines crossing through center at 0°, 45°, 90°, 135° — each enters and exits
  return [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map(angle => ({
    p1: {
      x: cx + (radius + 50) * Math.cos(angle),
      y: cy + (radius + 50) * Math.sin(angle),
    },
    p2: {
      x: cx - (radius + 50) * Math.cos(angle),
      y: cy - (radius + 50) * Math.sin(angle),
    },
  }));
}

// ── isDrum ─────────────────────────────────────────────────────────────────────

describe('isDrum', () => {
  it('returns true for drum instruments', () => {
    for (const d of ['bd', 'sd', 'hh', 'cp']) {
      expect(isDrum(d)).toBe(true);
    }
  });

  it('returns false for non-drum instruments', () => {
    for (const s of ['sine', 'sawtooth', 'superpiano', 'gm_acoustic_bass', 'fm']) {
      expect(isDrum(s)).toBe(false);
    }
  });
});

// ── Constructor defaults ──────────────────────────────────────────────────────

describe('CanvasShape constructor', () => {
  it('circle defaults to bd instrument', () => {
    const s = new CanvasShape(0, 0, 'circle');
    expect(s.instrument).toBe('bd');
  });

  it('sweeper defaults to sine instrument', () => {
    const s = new CanvasShape(0, 0, 'sweeper');
    expect(s.instrument).toBe('sine');
  });

  it('playheadAngle starts at 3π/2 (12 o\'clock)', () => {
    const s = new CanvasShape(0, 0, 'circle');
    expect(s.playheadAngle).toBeCloseTo(3 * Math.PI / 2);
  });

  it('starts with empty intersections and animations', () => {
    const s = new CanvasShape(0, 0, 'circle');
    expect(s.cachedIntersections).toHaveLength(0);
    expect(s.activeAnimations).toHaveLength(0);
  });
});

// ── accentColor ───────────────────────────────────────────────────────────────

describe('accentColor', () => {
  it('returns teal for sweeper regardless of instrument', () => {
    const s = new CanvasShape(0, 0, 'sweeper');
    expect(s.accentColor).toBe('#2DD4BF');
  });

  it('returns coral for drum instruments', () => {
    const s = new CanvasShape(0, 0, 'circle');
    s.instrument = 'bd';
    expect(s.accentColor).toBe('#E8472C');
  });

  it('returns amber for key instruments', () => {
    const s = new CanvasShape(0, 0, 'circle');
    s.instrument = 'superpiano';
    expect(s.accentColor).toBe('#E8A050');
  });

  it('returns copper for synth instruments', () => {
    const s = new CanvasShape(0, 0, 'circle');
    s.instrument = 'sawtooth';
    expect(s.accentColor).toBe('#C87A2E');
  });
});

// ── containsPoint (hit-testing) ──────────────────────────────────────────────

describe('containsPoint', () => {
  it('circle: point inside returns true', () => {
    const s = new CanvasShape(100, 100, 'circle', 50);
    expect(s.containsPoint(110, 100)).toBe(true);
  });

  it('circle: point outside returns false', () => {
    const s = new CanvasShape(100, 100, 'circle', 50);
    expect(s.containsPoint(200, 200)).toBe(false);
  });

  it('circle: minimum hit area of 15px for tiny circles', () => {
    const s = new CanvasShape(100, 100, 'circle', 5);
    // 10px away — outside radius (5) but within min hit area (15)
    expect(s.containsPoint(110, 100)).toBe(true);
  });

  it('triangle: centroid returns true', () => {
    const s = new CanvasShape(100, 100, 'triangle', 60);
    expect(s.containsPoint(100, 100)).toBe(true);
  });

  it('triangle: far point returns false', () => {
    const s = new CanvasShape(100, 100, 'triangle', 60);
    expect(s.containsPoint(300, 300)).toBe(false);
  });

  it('rectangle: point inside returns true', () => {
    const s = new CanvasShape(100, 100, 'rectangle', 50);
    expect(s.containsPoint(100, 100)).toBe(true);
  });

  it('rectangle: point outside returns false', () => {
    const s = new CanvasShape(100, 100, 'rectangle', 50);
    expect(s.containsPoint(200, 200)).toBe(false);
  });

  it('sweeper: point near origin (within 30px) returns true', () => {
    const s = new CanvasShape(100, 100, 'sweeper', 400);
    expect(s.containsPoint(120, 100)).toBe(true);
  });

  it('sweeper: point far from origin and ray returns false', () => {
    const s = new CanvasShape(100, 100, 'sweeper', 400);
    // Place point far away perpendicular to the ray
    expect(s.containsPoint(100, 300)).toBe(false);
  });
});

// ── getIntersections ─────────────────────────────────────────────────────────

describe('getIntersections', () => {
  it('circle: line crossing through returns 2 points', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    const pts = s.getIntersections({
      p1: { x: -100, y: 0 },
      p2: { x: 100, y: 0 },
    });
    expect(pts).toHaveLength(2);
  });

  it('circle: line missing returns 0 points', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    const pts = s.getIntersections({
      p1: { x: -100, y: 200 },
      p2: { x: 100, y: 200 },
    });
    expect(pts).toHaveLength(0);
  });

  it('sweeper: always returns empty array', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    const pts = s.getIntersections({
      p1: { x: -100, y: 0 },
      p2: { x: 100, y: 0 },
    });
    expect(pts).toHaveLength(0);
  });

  it('triangle: line crossing returns 2 points', () => {
    const s = new CanvasShape(0, 0, 'triangle', 60);
    // Horizontal line through centroid
    const pts = s.getIntersections({
      p1: { x: -100, y: 0 },
      p2: { x: 100, y: 0 },
    });
    expect(pts).toHaveLength(2);
  });

  it('rectangle: line crossing returns 2 points', () => {
    const s = new CanvasShape(0, 0, 'rectangle', 50);
    const pts = s.getIntersections({
      p1: { x: -100, y: 0 },
      p2: { x: 100, y: 0 },
    });
    expect(pts).toHaveLength(2);
  });
});

// ── rebuildIntersectionCache ─────────────────────────────────────────────────

describe('rebuildIntersectionCache', () => {
  it('caches intersections for non-sweeper shapes', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    const lines = makeCrossLines(0, 0, 50);
    s.rebuildIntersectionCache(lines);
    // 4 lines × 2 intersections each = 8
    expect(s.cachedIntersections.length).toBe(8);
    expect(s.intersectionCount).toBe(8);
  });

  it('does nothing for sweeper shapes', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    expect(s.cachedIntersections).toHaveLength(0);
  });
});

// ── generateRhythmString ─────────────────────────────────────────────────────

describe('generateRhythmString', () => {
  it('produces all ~ with no intersections', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    const rhythm = s.generateRhythmString();
    expect(rhythm).not.toContain('1');
    // Should have RHYTHM_STEPS tildes
    const tildeCount = (rhythm.match(/~/g) || []).length;
    expect(tildeCount).toBe(RHYTHM_STEPS);
  });

  it('places 1 at step 0 for intersection at angle 0', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.cachedIntersections = [{ angle: 0, x: 50, y: 0 }];
    const rhythm = s.generateRhythmString();
    // First token after '[' should be '1'
    const tokens = rhythm.replace(/[[\]]/g, '').trim().split(/\s+/);
    expect(tokens[0]).toBe('1');
  });

  it('maps known angles to correct step positions', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    // Angle π = halfway around → step 128
    s.cachedIntersections = [{ angle: Math.PI, x: -50, y: 0 }];
    const rhythm = s.generateRhythmString();
    const tokens = rhythm.replace(/[[\]]/g, '').trim().split(/\s+/);
    expect(tokens[128]).toBe('1');
  });
});

// ── toStrudelCode (string-level checks) ──────────────────────────────────────

describe('toStrudelCode', () => {
  it('drum template contains s(), struct(), gain()', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'bd';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    expect(code).toContain('s("bd")');
    expect(code).toContain('.struct(');
    expect(code).toContain('.gain(0.8)');
  });

  it('synth template contains note(), lpf()', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'sawtooth';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    expect(code).toContain('note("c3 e3 g3 b3")');
    expect(code).toContain('.s("sawtooth")');
    expect(code).toContain('.lpf(1200)');
  });

  it('key template contains velocity()', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'superpiano';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    expect(code).toContain('.s("superpiano")');
    expect(code).toContain('.velocity(0.6)');
  });

  it('bass template contains decay and sustain', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'gm_acoustic_bass';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    expect(code).toContain('.s("gm_acoustic_bass")');
    expect(code).toContain('.decay(1.8)');
    expect(code).toContain('.sustain(0.7)');
  });

  it('contains shape-start, shape-end, and rhythm markers', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    const code = s.toStrudelCode();
    expect(code).toContain(`// @shape-start-${s.id}`);
    expect(code).toContain(`// @shape-end-${s.id}`);
    expect(code).toContain(`// @rhythm-${s.id}`);
  });

  it('ends with .p((id).toString())', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    const code = s.toStrudelCode();
    expect(code).toContain(`.p((${s.id}).toString())`);
  });

  it('sweeper uses freq() pattern, no rhythm marker', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.rebuildSweepTicks(makeCrossLines(0, 0, 100), 315);
    const code = s.toStrudelCode();
    expect(code).toContain('freq(');
    expect(code).not.toContain('@rhythm-');
    expect(code).toContain(`// @shape-start-${s.id}`);
    expect(code).toContain(`// @shape-end-${s.id}`);
  });
});

// ── computeSweepClusters ─────────────────────────────────────────────────────

describe('computeSweepClusters', () => {
  it('produces clusters with freq in [100, 1000] Hz', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = 4;
    const lines = makeCrossLines(0, 0, 100);
    s.computeSweepClusters(lines, 315);
    for (const c of s.sweepClusters) {
      expect(c.freq).toBeGreaterThanOrEqual(100);
      expect(c.freq).toBeLessThanOrEqual(1000);
    }
  });

  it('produces clusters with gain in [0.6, 0.9]', () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = 4;
    const lines = makeCrossLines(0, 0, 100);
    s.computeSweepClusters(lines, 315);
    for (const c of s.sweepClusters) {
      expect(c.gain).toBeGreaterThanOrEqual(0.6);
      expect(c.gain).toBeLessThanOrEqual(0.9);
    }
  });

  it('multi-arm sweeper produces more clusters', () => {
    const lines = makeCrossLines(0, 0, 100);

    const s1 = new CanvasShape(0, 0, 'sweeper', 400);
    s1.sweepCount = 1;
    s1.k = 2;
    s1.computeSweepClusters(lines, 315);
    const count1 = s1.sweepClusters.length;

    const s2 = new CanvasShape(0, 0, 'sweeper', 400);
    s2.sweepCount = 3;
    s2.k = 2;
    s2.playheadAngle = s1.playheadAngle;
    s2.computeSweepClusters(lines, 315);
    const count3 = s2.sweepClusters.length;

    expect(count3).toBeGreaterThanOrEqual(count1);
  });
});

// ── stepPlayhead ─────────────────────────────────────────────────────────────

describe('stepPlayhead', () => {
  it('advances angle proportional to deltaMs and CPM', () => {
    const s = new CanvasShape(0, 0, 'circle', 60);
    const initial = s.playheadAngle;
    s.stepPlayhead(100, 10, 'constant-time');
    expect(s.playheadAngle).not.toBeCloseTo(initial);
    expect(s.playheadAngle).toBeGreaterThan(0);
  });

  it('does not change angle when deltaMs <= 0', () => {
    const s = new CanvasShape(0, 0, 'circle', 60);
    const initial = s.playheadAngle;
    s.stepPlayhead(0, 10, 'constant-time');
    expect(s.playheadAngle).toBeCloseTo(initial);
    s.stepPlayhead(-5, 10, 'constant-time');
    expect(s.playheadAngle).toBeCloseTo(initial);
  });

  it('constant-time: same increment regardless of size', () => {
    const s1 = new CanvasShape(0, 0, 'circle', 30);
    const s2 = new CanvasShape(0, 0, 'circle', 200);
    s1.playheadAngle = 0;
    s2.playheadAngle = 0;
    s1.stepPlayhead(100, 10, 'constant-time');
    s2.stepPlayhead(100, 10, 'constant-time');
    expect(s1.playheadAngle).toBeCloseTo(s2.playheadAngle);
  });

  it('constant-speed: larger size means smaller angular increment', () => {
    const s1 = new CanvasShape(0, 0, 'circle', 30);
    const s2 = new CanvasShape(0, 0, 'circle', 200);
    s1.playheadAngle = 0;
    s2.playheadAngle = 0;
    s1.stepPlayhead(100, 10, 'constant-speed');
    s2.stepPlayhead(100, 10, 'constant-speed');
    expect(s1.playheadAngle).toBeGreaterThan(s2.playheadAngle);
  });

  it('wraps angle at 2π', () => {
    const s = new CanvasShape(0, 0, 'circle', 60);
    s.playheadAngle = 0;
    // Step enough to go past 2π: at CPM=60, one cycle = 1s, so 1500ms > one cycle
    s.stepPlayhead(1500, 60, 'constant-time');
    expect(s.playheadAngle).toBeGreaterThanOrEqual(0);
    expect(s.playheadAngle).toBeLessThan(Math.PI * 2);
  });
});

// ── checkAndFireCollisions ───────────────────────────────────────────────────

describe('checkAndFireCollisions', () => {
  it('detects intersection when playhead crosses it', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    // Place intersection at angle 0.5
    s.cachedIntersections = [{ angle: 0.5, x: 50, y: 0 }];
    s.prevPlayheadAngle = 0.3;
    s.playheadAngle = 0.7;
    const triggered = s.checkAndFireCollisions();
    expect(triggered).toHaveLength(1);
    expect(triggered[0].angle).toBeCloseTo(0.5);
  });

  it('returns empty when playhead does not cross any intersection', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.cachedIntersections = [{ angle: 2.0, x: 50, y: 0 }];
    s.prevPlayheadAngle = 0.3;
    s.playheadAngle = 0.7;
    expect(s.checkAndFireCollisions()).toHaveLength(0);
  });

  it('handles 2π → 0 wrap-around correctly', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    // Intersection near 0, playhead wrapping from ~6.0 to ~0.3
    s.cachedIntersections = [{ angle: 0.1, x: 50, y: 0 }];
    s.prevPlayheadAngle = 6.0;  // just below 2π
    s.playheadAngle = 0.3;      // just past 0
    const triggered = s.checkAndFireCollisions();
    expect(triggered).toHaveLength(1);
  });
});

// ── triggerAt + stepAnimations ────────────────────────────────────────────────

describe('animations', () => {
  it('triggerAt pushes animation to activeAnimations', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.triggerAt(10, 20);
    expect(s.activeAnimations).toHaveLength(1);
    expect(s.activeAnimations[0]).toMatchObject({ x: 10, y: 20, frame: 0 });
  });

  it('stepAnimations increments frame counters', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.triggerAt(10, 20);
    s.stepAnimations();
    expect(s.activeAnimations[0].frame).toBe(1);
  });

  it('stepAnimations prunes expired animations', () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.triggerAt(10, 20);
    // Advance to maxFrames (18)
    for (let i = 0; i < 18; i++) s.stepAnimations();
    expect(s.activeAnimations).toHaveLength(0);
  });
});
