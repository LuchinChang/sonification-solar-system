import { CanvasShape, resetNextId } from '../shapes';
import {
  validateSnapshot,
  inspectSnapshot,
  SNAPSHOT_VERSION,
  type ConfigSnapshot,
  type NodeGraphSnapshot,
} from '../config-snapshot';

// ── Round-trip: toConfig → fromConfig → toConfig must be identical ────────────

describe('ConfigSnapshot round-trip', () => {
  beforeEach(() => resetNextId(0));

  // Non-sweeper shape types are being quarantined (Unit 1). Their round-trip
  // tests are kept here for when/if they're revived — skipped for now.
  it.skip('circle survives round-trip (quarantined in Unit 1)', () => {
    const original = new CanvasShape(100, 200, 'circle', 80);
    original.instrument = 'sine';
    const cfg = original.toConfig();
    const restored = CanvasShape.fromConfig(cfg);
    expect(restored.toConfig()).toEqual(cfg);
  });

  it.skip('triangle survives round-trip (quarantined in Unit 1)', () => {
    const original = new CanvasShape(300, 150, 'triangle', 120);
    original.instrument = 'superpiano';
    const cfg = original.toConfig();
    const restored = CanvasShape.fromConfig(cfg);
    expect(restored.toConfig()).toEqual(cfg);
  });

  it.skip('rectangle survives round-trip (quarantined in Unit 1)', () => {
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

  it('sweeper round-trips with a node-graph snapshot', () => {
    const graph: NodeGraphSnapshot = {
      nodes: [
        { id: 'n1', defType: 'oscillator', x: 10, y: 20, params: { freq: 440, wave: 'sine' } },
        { id: 'n2', defType: 'gain',       x: 80, y: 20, params: { amp: 0.7 } },
      ],
      edges: [
        { id: 'e1', fromPort: 'n1:out', toPort: 'n2:in' },
      ],
    };
    const original = new CanvasShape(50, 50, 'sweeper', 400);
    original.graph = graph;
    const cfg = original.toConfig();
    expect(cfg.graph).toEqual(graph);
    const restored = CanvasShape.fromConfig(cfg);
    expect(restored.graph).toEqual(graph);
    expect(restored.toConfig()).toEqual(cfg);
  });

  it('sweeper without a graph does not emit the graph field', () => {
    const original = new CanvasShape(50, 50, 'sweeper', 400);
    const cfg = original.toConfig();
    expect(cfg.graph).toBeUndefined();
  });

  it('preserves shape ID through round-trip', () => {
    const original = new CanvasShape(0, 0, 'sweeper', 60);
    const savedId = original.id;
    const restored = CanvasShape.fromConfig(original.toConfig());
    expect(restored.id).toBe(savedId);
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
    // Populate graph so the key appears on the serialized config.
    shape.graph = { nodes: [], edges: [] };
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

describe('validateSnapshot (v2)', () => {
  const VALID: ConfigSnapshot = {
    version: SNAPSHOT_VERSION,
    patternId: 'venus-earth',
    sampleRate: 500,
    cpm: 10,
    playbackMode: 'constant-time',
    theme: 'dark',
    shapes: [
      { id: 2, type: 'sweeper', x: 50, y: 50, size: 400, instrument: 'sine', k: 4, sweepCount: 2, startAngle: 4.71, ticks: 60 },
    ],
  };

  it('accepts a valid v2 snapshot', () => {
    expect(validateSnapshot(VALID)).toBe(true);
  });

  it('accepts a sweeper with a graph field', () => {
    const withGraph: ConfigSnapshot = {
      ...VALID,
      shapes: [{
        ...VALID.shapes[0],
        graph: {
          nodes: [{ id: 'a', defType: 'osc', x: 0, y: 0, params: { freq: 220 } }],
          edges: [],
        },
      }],
    };
    expect(validateSnapshot(withGraph)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateSnapshot(null)).toBe(false);
  });

  it('rejects v1 snapshots with a legacy-version rejection', () => {
    const v1 = { ...VALID, version: 1 };
    const rejection = inspectSnapshot(v1);
    expect(rejection).not.toBeNull();
    expect(rejection?.kind).toBe('legacy-version');
    expect(rejection?.message.toLowerCase()).toContain('v1');
    expect(validateSnapshot(v1)).toBe(false);
  });

  it('rejects unknown future versions as invalid', () => {
    const rejection = inspectSnapshot({ ...VALID, version: 99 });
    expect(rejection?.kind).toBe('invalid');
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
      shapes: [{ id: 1, type: 'sweeper' }],
    })).toBe(false);
  });

  it('rejects a malformed graph field', () => {
    expect(validateSnapshot({
      ...VALID,
      shapes: [{
        ...VALID.shapes[0],
        graph: { nodes: [{ id: 'x' }], edges: [] },  // missing required fields
      }],
    })).toBe(false);
  });
});
