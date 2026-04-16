import { CanvasShape, resetNextId } from '../shapes';
import { validateSnapshot, type ConfigSnapshot } from '../config-snapshot';

// ── Round-trip: toConfig → fromConfig → toConfig must be identical ────────────

describe('ConfigSnapshot round-trip', () => {
  beforeEach(() => resetNextId(0));

  it('circle survives round-trip', () => {
    const original = new CanvasShape(100, 200, 'circle', 80);
    original.instrument = 'sine';
    const cfg = original.toConfig();
    const restored = CanvasShape.fromConfig(cfg);
    expect(restored.toConfig()).toEqual(cfg);
  });

  it('triangle survives round-trip', () => {
    const original = new CanvasShape(300, 150, 'triangle', 120);
    original.instrument = 'superpiano';
    const cfg = original.toConfig();
    const restored = CanvasShape.fromConfig(cfg);
    expect(restored.toConfig()).toEqual(cfg);
  });

  it('rectangle survives round-trip', () => {
    const original = new CanvasShape(50, 400, 'rectangle', 200);
    original.instrument = 'gm_acoustic_bass';
    const cfg = original.toConfig();
    const restored = CanvasShape.fromConfig(cfg);
    expect(restored.toConfig()).toEqual(cfg);
  });

  it('sweeper survives round-trip with all params', () => {
    const original = new CanvasShape(50, 50, 'sweeper', 400);
    original.instrument = 'fm';
    original.k = 7;
    original.sweepCount = 4;
    original.startAngle = Math.PI;
    original.ticks = 120;
    original.freqLow = 200;
    original.freqHigh = 3000;
    original.colorIndex = 5;
    const cfg = original.toConfig();
    const restored = CanvasShape.fromConfig(cfg);
    expect(restored.toConfig()).toEqual(cfg);
    expect(restored.freqLow).toBe(200);
    expect(restored.freqHigh).toBe(3000);
    expect(restored.colorIndex).toBe(5);
  });

  it('preserves shape ID through round-trip', () => {
    const original = new CanvasShape(0, 0, 'circle', 60);
    const savedId = original.id;
    const restored = CanvasShape.fromConfig(original.toConfig());
    expect(restored.id).toBe(savedId);
  });

  it('sweeper-only fields are omitted for non-sweeper shapes', () => {
    const circle = new CanvasShape(0, 0, 'circle', 60);
    const cfg = circle.toConfig();
    expect(cfg.k).toBeUndefined();
    expect(cfg.sweepCount).toBeUndefined();
    expect(cfg.startAngle).toBeUndefined();
    expect(cfg.ticks).toBeUndefined();
    expect(cfg.freqLow).toBeUndefined();
    expect(cfg.freqHigh).toBeUndefined();
    expect(cfg.colorIndex).toBeUndefined();
  });
});

// ── Property coverage: ensures new CanvasShape fields are classified ──────────

describe('ShapeConfig property coverage', () => {
  /**
   * Exhaustive list of CanvasShape properties that are DERIVED (not serialized).
   * ★ When adding a new derived property to CanvasShape, add it here too.
   *   If you forget, this test will fail — forcing a conscious classification.
   */
  const DERIVED_PROPS = new Set([
    'isSelected',
    'playheadAngle',
    'prevPlayheadAngle',
    'cachedIntersections',
    'activeAnimations',
    'intersectionCount',
    'sweepClusters',
    'sweepTicks',
    'sweepAudioRefTime',
    'sweepPhaseAtRef',
  ]);

  it('every CanvasShape property is in ShapeConfig or DERIVED_PROPS', () => {
    resetNextId(0);
    // Use sweeper so ALL properties are populated (sweeper has the superset)
    const shape = new CanvasShape(0, 0, 'sweeper', 100);
    const config = shape.toConfig();
    const configKeys = new Set(Object.keys(config));

    for (const key of Object.keys(shape)) {
      if (DERIVED_PROPS.has(key)) continue;
      expect(configKeys.has(key)).toBe(true);
    }
  });

  it('DERIVED_PROPS only contains actual CanvasShape properties', () => {
    resetNextId(0);
    const shape = new CanvasShape(0, 0, 'sweeper', 100);
    const shapeKeys = new Set(Object.keys(shape));

    for (const key of DERIVED_PROPS) {
      expect(shapeKeys.has(key)).toBe(true);
    }
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

describe('validateSnapshot', () => {
  const VALID: ConfigSnapshot = {
    version: 1,
    patternId: 'venus-earth',
    sampleRate: 500,
    cpm: 10,
    playbackMode: 'constant-time',
    theme: 'dark',
    shapes: [
      { id: 1, type: 'circle', x: 100, y: 200, size: 60, instrument: 'bd' },
      { id: 2, type: 'sweeper', x: 50, y: 50, size: 400, instrument: 'sine', k: 4, sweepCount: 2, startAngle: 4.71, ticks: 60 },
    ],
  };

  it('accepts a valid snapshot', () => {
    expect(validateSnapshot(VALID)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateSnapshot(null)).toBe(false);
  });

  it('rejects wrong version', () => {
    expect(validateSnapshot({ ...VALID, version: 2 })).toBe(false);
  });

  it('rejects out-of-range sampleRate', () => {
    expect(validateSnapshot({ ...VALID, sampleRate: 5000 })).toBe(false);
  });

  it('rejects out-of-range cpm', () => {
    expect(validateSnapshot({ ...VALID, cpm: 200 })).toBe(false);
  });

  it('rejects invalid playbackMode', () => {
    expect(validateSnapshot({ ...VALID, playbackMode: 'turbo' })).toBe(false);
  });

  it('rejects invalid shape type', () => {
    expect(validateSnapshot({
      ...VALID,
      shapes: [{ id: 1, type: 'hexagon', x: 0, y: 0, size: 60, instrument: 'bd' }],
    })).toBe(false);
  });

  it('rejects shape with missing fields', () => {
    expect(validateSnapshot({
      ...VALID,
      shapes: [{ id: 1, type: 'circle' }],
    })).toBe(false);
  });
});
