// src/shapes.ts
//
// Strict TypeScript model for every user-placed shape on the orbital canvas.
// Contains: geometry, hit-testing, playhead timing, collision detection,
//           trigger animations, and Strudel code generation.
// Audio (Strudel) is intentionally NOT wired here — code generation only.

import type { Point } from './geometry';
import { angleStdev, getLineCircleIntersections, getRaySegmentDist, pointToSegmentDist } from './geometry';
import { resolveOscillator } from './generator-options';
import type { ShapeConfig, NodeGraphSnapshot } from './config-snapshot';

// ── Public types ──────────────────────────────────────────────────────────────

// A "geometric probe" is any shape whose intersection with the orbital link-line
// field drives sound. Two probe kinds are live:
//   • 'sweeper' — a rotating ray cast outward from a pivot; reads clusters by
//                 distance (continuous contour → freq/gain).
//   • 'circle'  — a closed perimeter; an angular playhead sweeps it and the
//                 perimeter↔orbit crossings form a rhythm (discrete events).
// Both feed the SAME node-editor pipeline via sweepTicks[arm][tick][slot] — a
// circle is just sweepCount=1 with crossings binned by angle (bakeDiscreteTicks).
// LEGACY (still quarantined): 'triangle' | 'rectangle' polygon probes.
export type ShapeType   = 'sweeper' | 'circle';
// LEGACY: previous union was 'circle' | 'triangle' | 'rectangle' | 'sweeper'

/** True for discrete (closed-perimeter) probes whose audio is rhythm-first. */
export function isDiscreteProbe(type: ShapeType): boolean {
  return type === 'circle';
}
export type PlaybackMode = 'constant-time' | 'constant-speed';

/**
 * Per-sweeper arm-motion kinematics (Unit 10).
 * - 'normal'    : constant angular velocity, wrapping at 2π.
 * - 'ping-pong' : reverses direction after each full cycle of travel; audio
 *                 uses Strudel's `.palindrome()` so the 60-step pattern plays
 *                 forward/backward in lockstep with the visual arm.
 * Writing this field is the only side effect of the playback.mode node.
 */
export type SweeperPlaybackMode = 'normal' | 'ping-pong';

/** Pre-computed orbital intersection — angle (polar, 0…2π) + canvas coords. */
export interface CachedIntersection {
  angle: number;
  x: number;
  y: number;
}

/**
 * One density cluster on the sweeper ray — produced each frame by
 * computeSweepClusters() and consumed by draw() and Strudel signal callbacks.
 */
export interface SweepCluster {
  distance: number;  // px from ray origin
  density:  number;  // number of link lines in this cluster
  x:        number;  // canvas x of cluster centroid
  y:        number;  // canvas y of cluster centroid
  freq:     number;  // mapped Hz  : 100 + (dist/maxR) * 900
  gain:     number;  // mapped amp : min(density/20, 1.0) * 0.7
  /** Circular stdev (rad) of the angles of the link-lines making up this
   *  cluster. 0 for single-line clusters; folded to the half-circle so that
   *  parallel lines score as low-variance regardless of direction. */
  angleVariance: number;
}

/** Resolution of the binary rhythm grid (angular bins mapped to Strudel struct). */
export const RHYTHM_STEPS = 256;

// LEGACY: disabled 2026-04-21 — non-sweeper shape support, kept for future revival.
// To re-enable: un-comment this block and re-add 'circle' | 'triangle' | 'rectangle' to ShapeType.
/*
// ── Instrument classification ────────────────────────────────────────────────
// Used to choose the right Strudel code template and accent colour.

const DRUM_INSTRUMENTS = new Set(['bd', 'sd', 'hh', 'cp']);
const KEY_INSTRUMENTS  = new Set(['superpiano']);
const BASS_INSTRUMENTS = new Set(['gm_acoustic_bass']);
// Synths (sawtooth, sine, triangle, square, fm, …) → everything else

export function isDrum(instrument: string): boolean {
  return DRUM_INSTRUMENTS.has(instrument);
}
*/

// ── Module-private types ──────────────────────────────────────────────────────

interface TriggerAnimation {
  x: number;
  y: number;
  frame: number;
  maxFrames: number;
}

// ── Sweeper constants ─────────────────────────────────────────────────────────
/** Max gap (px) between sorted distances before starting a new cluster.
 *  Exported so the data-side `cluster-tolerance` node can read the live value
 *  it publishes onto globalThis.__sw_<id>_tol each frame. */
export const SWEEP_CLUSTER_THRESHOLD = 2;
/** Accent colour palette for probes — each probe gets a distinct hue. */
const SWEEP_PALETTE = ['#2DD4BF', '#C084FC', '#F472B6', '#60A5FA', '#FACC15', '#FB923C', '#34D399', '#A78BFA'];
/** Number of distinct probe accent colours before the palette must repeat. */
export const PROBE_PALETTE_SIZE = SWEEP_PALETTE.length;

/** Convert a hex colour (#RRGGBB) to an rgba() string with the given alpha. */
function hexRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Module-level ID counter ───────────────────────────────────────────────────
let _nextId = 0;

/** Reset the auto-increment ID counter (used when restoring a saved config). */
export function resetNextId(n: number): void { _nextId = n; }

// LEGACY: disabled 2026-04-21 — non-sweeper shape support, kept for future revival.
// To re-enable: un-comment this block and re-add 'circle' | 'triangle' | 'rectangle' to ShapeType.
/*
// ── Internal geometry helpers ─────────────────────────────────────────────────

// Finite line-segment intersection, or null when parallel/non-overlapping.
function segmentIntersect(
  a1: Point, a2: Point,
  b1: Point, b2: Point,
): Point | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  const dx = b1.x - a1.x, dy = b1.y - a1.y;
  const t  = (dx * d2y - dy * d2x) / cross;
  const u  = (dx * d1y - dy * d1x) / cross;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1)
    ? { x: a1.x + t * d1x, y: a1.y + t * d1y }
    : null;
}
*/

// ── CanvasShape ───────────────────────────────────────────────────────────────

export class CanvasShape {
  // ═══ PERSISTENT (saved in ConfigSnapshot via ShapeConfig) ═══════════════════
  // Adding a new persistent property? Update:
  //   1. ShapeConfig interface in config-snapshot.ts
  //   2. toConfig() below
  //   3. fromConfig() below
  //   4. Round-trip test in config-snapshot.test.ts
  readonly id: number;
  x: number;
  y: number;
  readonly type: ShapeType;
  /**
   * Active instrument — determines both the Strudel sound and the template.
   * Drums:  bd | sd | hh | cp
   * Synths: sawtooth | sine | triangle | square | fm
   * Keys:   piano
   */
  instrument: string;
  /** Radius for circles; half-span for triangles / rectangles. */
  size: number;
  /** Top-K clusters to track (sweeper only). */
  k: number;
  /** Number of evenly-spaced arms (sweeper only). Default 1, range 1–8. */
  sweepCount: number;
  /**
   * Absolute angle of the 12 o'clock position (tick 0) in canvas radians [0, 2π).
   * Default 3π/2 = UP.  Adjusted per 1° scroll steps on selected sweepers.
   */
  startAngle: number;
  /** Number of discrete positions per full revolution (sweeper only). Default 60. */
  ticks: number;
  /**
   * Quantization resolution for the live playhead (sweeper only). Default 120.
   * When > 0 the playhead angle snaps to `fineness` discrete positions around
   * 2π — round(phase · fineness / 2π) · (2π / fineness) — producing visible
   * stair-steps. Lower values = chunkier motion, higher values = smoother.
   */
  fineness: number;
  /** Lower frequency bound for sweeper distance mapping (Hz). */
  freqLow: number;
  /** Upper frequency bound for sweeper distance mapping (Hz). */
  freqHigh: number;
  /** Palette index for sweeper accent colour. */
  colorIndex: number;
  /**
   * Per-sweeper node-graph snapshot (sweeper only). `null` until the user opens
   * the node editor on this sweeper; only persisted to/from ShapeConfig when set.
   * TODO(Unit 14): replace with a reference to the live NodeGraph instance once
   * Unit 4's src/node-editor/ lands.
   */
  graph: NodeGraphSnapshot | null;

  // ═══ DERIVED (recomputed, never serialized) ═════════════════════════════════
  // Adding here? Add to DERIVED_PROPS in config-snapshot.test.ts
  isSelected: boolean;
  /** Current playhead angle in [0, 2π). */
  playheadAngle: number;
  /** Playhead angle from the previous animation frame. Used for collision sweep. */
  prevPlayheadAngle: number;
  /** Pre-computed intersection angles + canvas coords. Rebuilt on geometry change. */
  cachedIntersections: CachedIntersection[];
  /** Live trigger animations (glowing rings). Pruned each frame. */
  activeAnimations: TriggerAnimation[];
  /** Last tick the playhead fired a crossing ring for; edge-triggers the pulse. */
  lastRingTick: number;
  /** Intersection count — kept up-to-date by rebuildIntersectionCache(). */
  intersectionCount: number;
  /** Live clusters recomputed every frame (sweeper only). Flat across all arms. */
  sweepClusters: SweepCluster[];
  /**
   * Pre-computed clusters indexed [armIdx][tickIdx].
   * Rebuilt on geometry change (sample rate / resize / startAngle / k / sweepCount / ticks).
   */
  sweepTicks: SweepCluster[][][];
  /**
   * Effective `maxR` used for the most recent `rebuildSweepTicks` call.
   * Stored so the node-editor codegen can normalize per-tick distance
   * values (0..1) without reaching into `AppState` for `orbitalMaxRadius`.
   * Matches the `maxR` argument passed to `rebuildSweepTicks`/`computeSweepClusters`
   * — i.e. `sweeperMaxR(shape, state) = min(shape.size, orbitalMaxRadius)`.
   */
  sweepMaxR: number;
  /** AudioContext.currentTime captured when playback starts (sweeper phase sync, runtime-only). */
  sweepAudioRefTime: number;
  /** Fractional cycle phase (0..1) accumulated up to the last ref anchor (sweeper phase sync, runtime-only). */
  sweepPhaseAtRef: number;
  /**
   * Unit 10 — per-sweeper arm kinematics. Written by the playback.mode node
   * when the editor commits; read every frame by stepPlayhead(). Sweeper-only
   * (guarded by `type === 'sweeper'` at the call site).
   */
  playbackMode: SweeperPlaybackMode;
  /** Ping-pong direction of travel: +1 forward (CCW-ish), -1 reversed. */
  sweepDirection: 1 | -1;
  /** Held (CONTEXT.md): arm frozen, current tick's voices sustained. */
  held: boolean;
  /** Ping-pong cumulative angular distance since the last direction flip. */
  sweepPingPongAccum: number;

  constructor(x: number, y: number, type: ShapeType, size = 60) {
    this.id                  = ++_nextId;
    this.x                   = x;
    this.y                   = y;
    this.type                = type;
    // LEGACY: previous default was `type === 'sweeper' ? 'sine' : 'bd'` to cover non-sweeper shapes.
    // Generator selection KEY, not a raw oscillator — both bake paths resolve it
    // via resolveOscillator(). 'sig1' = Signature Waveform 1 (a placeholder that
    // currently sounds like sine). Mirrors DEFAULT_GENERATOR_KEY in
    // generator-options.ts (kept as a literal here to avoid coupling the
    // constructor to that module's import).
    this.instrument          = 'sig1';
    this.size                = size;
    this.isSelected          = false;
    this.playheadAngle       = 3 * Math.PI / 2;  // 12 o'clock, stays in [0, 2π)
    this.prevPlayheadAngle   = 3 * Math.PI / 2;
    this.cachedIntersections = [];
    this.activeAnimations    = [];
    this.lastRingTick        = -1;
    this.intersectionCount   = 0;
    this.k                   = 4;
    this.sweepCount          = 1;
    this.sweepClusters       = [];
    this.startAngle          = 3 * Math.PI / 2;  // 90° math = UP = 12 o'clock
    // `ticks` (baked-pattern length) is tied to `fineness` — one slider drives
    // both the visual playhead snap (see stepPlayhead) and the Strudel pattern
    // length emitted by compileGraphToStrudel. Unified so the audible pattern
    // density tracks the visual arm density.
    this.fineness            = 120;
    this.ticks               = 120;
    this.sweepTicks          = [];
    this.sweepMaxR           = 0;
    this.freqLow             = 100;
    this.freqHigh            = 1000;
    this.colorIndex          = 0;
    this.graph               = null;
    this.sweepAudioRefTime   = 0;
    this.sweepPhaseAtRef     = 0;
    this.playbackMode        = 'normal';
    this.sweepDirection      = 1;
    this.sweepPingPongAccum  = 0;
    this.held                = false;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Serialize to the portable config format (ShapeConfig). */
  toConfig(): ShapeConfig {
    const base: ShapeConfig = {
      id: this.id, type: this.type, x: this.x, y: this.y,
      size: this.size, instrument: this.instrument,
    };
    // Both probe kinds (sweeper + discrete circle) carry the same baked-pattern
    // fields and an optional node-graph, so persist them for either.
    if (this.type === 'sweeper' || this.type === 'circle') {
      base.k          = this.k;
      base.sweepCount = this.sweepCount;
      base.startAngle = this.startAngle;
      base.ticks      = this.ticks;
      base.fineness   = this.fineness;
      base.freqLow    = this.freqLow;
      base.freqHigh   = this.freqHigh;
      base.colorIndex = this.colorIndex;
      if (this.graph !== null) base.graph = this.graph;
    }
    return base;
  }

  /** Reconstruct from a portable config. Caches must be rebuilt after. */
  static fromConfig(cfg: ShapeConfig): CanvasShape {
    const s = new CanvasShape(cfg.x, cfg.y, cfg.type, cfg.size);
    // Override the auto-assigned ID with the saved one
    (s as { id: number }).id = cfg.id;
    s.instrument = cfg.instrument;
    if (cfg.k          !== undefined) s.k          = cfg.k;
    if (cfg.sweepCount !== undefined) s.sweepCount = cfg.sweepCount;
    if (cfg.startAngle !== undefined) s.startAngle = cfg.startAngle;
    if (cfg.ticks      !== undefined) s.ticks      = cfg.ticks;
    if (cfg.fineness   !== undefined) s.fineness   = cfg.fineness;
    if (cfg.freqLow    !== undefined) s.freqLow    = cfg.freqLow;
    if (cfg.freqHigh   !== undefined) s.freqHigh   = cfg.freqHigh;
    if (cfg.colorIndex !== undefined) s.colorIndex = cfg.colorIndex;
    if (cfg.graph      !== undefined) s.graph      = cfg.graph;
    return s;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    const color = this.accentColor;
    ctx.strokeStyle = color;
    ctx.lineWidth   = this.isSelected ? 2.5 : 1.5;
    // Always show glow — every shape has an instrument from spawn
    ctx.shadowColor = color;
    ctx.shadowBlur  = this.isSelected ? 22 : 9;
    ctx.beginPath();
    // LEGACY (still quarantined): 'triangle' | 'rectangle' outline cases.
    if (this.type === 'circle') {
      // Discrete probe: the closed perimeter the playhead sweeps.
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    } else {
      // Sweeper: draw all N arms evenly spaced around the pivot
      const armSpacing = (Math.PI * 2) / this.sweepCount;
      for (let arm = 0; arm < this.sweepCount; arm++) {
        const angle = (this.playheadAngle + arm * armSpacing) % (Math.PI * 2);
        const ex = this.x + this.size * Math.cos(angle);
        const ey = this.y + this.size * Math.sin(angle);
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(ex, ey);
      }
    }
    ctx.stroke();

    // Static pre-computed tick dots — faint background showing the full pattern.
    // Both probe kinds store each cluster's canvas centroid in (c.x, c.y), so
    // this renderer is geometry-agnostic: sweeper dots sit along the ray, circle
    // dots sit at the actual perimeter↔orbit crossing points.
    if (this.sweepTicks.length > 0) {
      ctx.save();
      ctx.shadowBlur = 0;
      const armTicks0 = this.sweepTicks[0] ?? [];
      for (let arm = 0; arm < this.sweepTicks.length; arm++) {
        const armTicks = this.sweepTicks[arm] ?? armTicks0;
        for (let i = 0; i < armTicks.length; i++) {
          for (const c of armTicks[i]) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = hexRgba(this.sweepColor, Math.min(c.gain * 0.35, 0.28));
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    // Circle playhead is shown by the bright perimeter dot (drawPlayhead) plus
    // the expanding-ring pulse on each crossing (drawAnimations) — no clock-hand
    // arm. (Removed 2026-06-07: the centre→perimeter line was visual noise.)

    // Live radar blips at current arm position — opacity varies with density
    if (this.type === 'sweeper') {
      const maxDensity = this.sweepClusters.length > 0
        ? Math.max(...this.sweepClusters.map(c => c.density))
        : 1;

      for (const c of this.sweepClusters) {
        const alpha = Math.min(c.density / maxDensity, 1.0);
        const color = hexRgba(this.sweepColor, Math.max(0.5, alpha));

        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.shadowBlur  = 4;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /** Draws the travelling playhead dot on this shape's perimeter. */
  drawPlayhead(ctx: CanvasRenderingContext2D): void {
    // Sweepers: the rotating line IS the playhead — no separate dot.
    if (this.type === 'sweeper') return;
    // Discrete circle: bright dot riding the perimeter at the current angle.
    // LEGACY (still quarantined): triangle/rectangle used getPlayheadPosition()
    // with rayToEdge; the circle case is a direct perimeter parametrisation.
    const px = this.x + this.size * Math.cos(this.playheadAngle);
    const py = this.y + this.size * Math.sin(this.playheadAngle);
    ctx.save();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#FFFDE7';
    ctx.beginPath();
    ctx.arc(px, py, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draws all live expanding-ring trigger animations — the circle's original
   * playhead pulse. Revived 2026-06-07: now fired by main.ts when the playhead
   * enters a tick that holds a crossing (a rhythm hit), so each ring blooms at
   * the crossing point in time with the audio. Drawn in the probe's accent
   * colour so the pulse shares the circle's colour identity (the white position
   * dot is the only element that stays uncoloured). Empty for sweepers (they
   * never push activeAnimations).
   */
  drawAnimations(ctx: CanvasRenderingContext2D): void {
    if (this.activeAnimations.length === 0) return;
    const color = this.accentColor;
    ctx.save();
    for (const anim of this.activeAnimations) {
      const t      = anim.frame / anim.maxFrames;
      const radius = 5 + t * 18;
      ctx.globalAlpha  = (1 - t) * 0.80;
      ctx.strokeStyle  = color;
      ctx.lineWidth    = 2.5 * (1 - t * 0.5);
      ctx.shadowColor  = color;
      ctx.shadowBlur   = 12 * (1 - t);
      ctx.beginPath();
      ctx.arc(anim.x, anim.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // LEGACY: disabled 2026-04-21 — non-sweeper shape support, kept for future revival.
  // To re-enable: un-comment this block and re-add 'triangle' to ShapeType.
  /*
  private pathTriangle(ctx: CanvasRenderingContext2D): void {
    const h = this.size * Math.sqrt(3);
    ctx.moveTo(this.x,              this.y - h * 0.667);
    ctx.lineTo(this.x + this.size,  this.y + h * 0.333);
    ctx.lineTo(this.x - this.size,  this.y + h * 0.333);
    ctx.closePath();
  }
  */

  // ── Accent colour — derived from instrument type ──────────────────────────

  /** Sweeper accent colour from the palette, based on colorIndex. */
  get sweepColor(): string {
    return SWEEP_PALETTE[this.colorIndex % SWEEP_PALETTE.length];
  }

  get accentColor(): string {
    // Only sweepers are active; fall back to sweeper palette.
    if (this.type === 'sweeper') return this.sweepColor;
    // LEGACY: disabled 2026-04-21 — non-sweeper instrument→colour mapping.
    // To re-enable: un-comment this block and restore DRUM_INSTRUMENTS/KEY_INSTRUMENTS.
    /*
    if (DRUM_INSTRUMENTS.has(this.instrument)) return '#E8472C';    // coral  — drums
    if (KEY_INSTRUMENTS.has(this.instrument))  return '#E8A050';    // amber  — keys
    return '#C87A2E';                                               // copper — synths
    */
    return this.sweepColor;
  }

  // ── Hit-testing ───────────────────────────────────────────────────────────

  containsPoint(px: number, py: number): boolean {
    // Discrete circle: selectable anywhere inside the disc (min 15px target).
    // LEGACY (still quarantined): triangle barycentric + rectangle AABB cases.
    if (this.type === 'circle') {
      return Math.hypot(px - this.x, py - this.y) <= Math.max(this.size, 15);
    }
    // Sweeper: selectable within 30px of origin OR within 8px of the rotating ray.
    if (Math.hypot(px - this.x, py - this.y) <= 30) return true;
    const ex = this.x + this.size * Math.cos(this.playheadAngle);
    const ey = this.y + this.size * Math.sin(this.playheadAngle);
    return pointToSegmentDist(px, py, this.x, this.y, ex, ey) <= 8;
  }

  // LEGACY: disabled 2026-04-21 — triangle hit-test helper, kept for future revival.
  // To re-enable: un-comment this block and restore 'triangle' ShapeType.
  /*
  private pointInTriangle(p: Point): boolean {
    const h  = this.size * Math.sqrt(3);
    const v1: Point = { x: this.x,             y: this.y - h * 0.667 };
    const v2: Point = { x: this.x + this.size,  y: this.y + h * 0.333 };
    const v3: Point = { x: this.x - this.size,  y: this.y + h * 0.333 };
    const side = (pa: Point, pb: Point, pc: Point) =>
      (pa.x - pc.x) * (pb.y - pc.y) - (pb.x - pc.x) * (pa.y - pc.y);
    const d1 = side(p, v1, v2), d2 = side(p, v2, v3), d3 = side(p, v3, v1);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  */

  // ── Orbital line intersection ──────────────────────────────────────────────

  getIntersections(line: { p1: Point; p2: Point }): Point[] {
    // Discrete circle: where an orbital link-line crosses the perimeter.
    // LEGACY (still quarantined): triangle/rectangle used edgeIntersections().
    if (this.type === 'circle') {
      return getLineCircleIntersections(line.p1, line.p2, this.x, this.y, this.size);
    }
    return []; // sweeper uses computeSweepClusters() instead
  }

  // LEGACY: disabled 2026-04-21 — polygon-edge intersection helpers.
  // To re-enable: un-comment this block and restore segmentIntersect.
  /*
  private edgeIntersections(
    line: { p1: Point; p2: Point }, edges: [Point, Point][],
  ): Point[] {
    const hits: Point[] = [];
    for (const [a, b] of edges) {
      const pt = segmentIntersect(line.p1, line.p2, a, b);
      if (pt !== null) hits.push(pt);
    }
    return hits;
  }

  private triangleEdges(): [Point, Point][] {
    const h  = this.size * Math.sqrt(3);
    const v1: Point = { x: this.x,             y: this.y - h * 0.667 };
    const v2: Point = { x: this.x + this.size,  y: this.y + h * 0.333 };
    const v3: Point = { x: this.x - this.size,  y: this.y + h * 0.333 };
    return [[v1, v2], [v2, v3], [v3, v1]];
  }

  private rectEdges(): [Point, Point][] {
    const l = this.x - this.size, r = this.x + this.size;
    const t = this.y - this.size * 0.6, b = this.y + this.size * 0.6;
    const tl: Point = { x: l, y: t }, tr: Point = { x: r, y: t };
    const br: Point = { x: r, y: b }, bl: Point = { x: l, y: b };
    return [[tl, tr], [tr, br], [br, bl], [bl, tl]];
  }
  */

  // ── Playhead system ───────────────────────────────────────────────────────

  /**
   * Pre-compute and cache every orbital intersection's polar angle + xy.
   * Must be called whenever: shape spawns, moves, resizes, or SAMPLE_RATE changes.
   * Also sets intersectionCount for the telemetry panel.
   */
  rebuildIntersectionCache(_linkLines: { p1: Point; p2: Point }[]): void {
    // Sweepers: intersections are dynamic per-frame via computeSweepClusters().
    if (this.type === 'sweeper') return;
    // LEGACY: disabled 2026-04-21 — non-sweeper static intersection cache.
    // To re-enable: un-comment this block.
    /*
    this.cachedIntersections = [];
    for (const line of _linkLines) {
      for (const pt of this.getIntersections(line)) {
        const raw   = Math.atan2(pt.y - this.y, pt.x - this.x);
        const angle = raw < 0 ? raw + Math.PI * 2 : raw;
        this.cachedIntersections.push({ angle, x: pt.x, y: pt.y });
      }
    }
    this.intersectionCount = this.cachedIntersections.length;
    */
  }

  /**
   * Advance the playhead by one frame.
   *
   * Global playback mode is always constant-time — every shape completes one
   * cycle in `60/CPM` seconds regardless of its size (Unit 1 removed the
   * global Const T / Const V toggle).
   *
   * For sweepers, the per-shape `playbackMode` (Unit 10, node-editor driven)
   * further re-shapes the kinematics — 'normal' keeps the linear behaviour and
   * 'ping-pong' reverses direction each cycle. Non-sweepers always use normal.
   */
  stepPlayhead(deltaMs: number, CPM: number): void {
    if (deltaMs <= 0) return;
    const duration = (60 / CPM) * 1000;


    if (this.type === 'sweeper' && this.playbackMode === 'ping-pong') {
      this._stepPingPong(deltaMs, duration);
      return;
    }

    const nextPhase = (this.playheadAngle + (deltaMs / duration) * Math.PI * 2)
                      % (Math.PI * 2);
    // Sweeper-only: quantize the phase to `fineness` discrete positions around
    // 2π, producing stair-step motion when fineness is small. Ping-pong uses
    // continuous motion — fineness is a normal-mode knob.
    if (this.type === 'sweeper' && this.fineness > 0) {
      const step = (Math.PI * 2) / this.fineness;
      this.playheadAngle = (Math.round(nextPhase / step) * step) % (Math.PI * 2);
    } else {
      this.playheadAngle = nextPhase;
    }
  }

  /**
   * Ping-pong step: advance by ω*dt in sweepDirection; when the cumulative
   * angular distance reaches 2π, flip direction and reset the accumulator.
   * Angle is kept in [0, 2π) by modulo with wrap-around for negative values.
   */
  private _stepPingPong(deltaMs: number, durationMs: number): void {
    const TAU    = Math.PI * 2;
    const deltaA = (deltaMs / durationMs) * TAU;
    this.playheadAngle = ((this.playheadAngle + deltaA * this.sweepDirection) % TAU + TAU) % TAU;
    this.sweepPingPongAccum += deltaA;
    if (this.sweepPingPongAccum >= TAU) {
      this.sweepDirection     = (this.sweepDirection === 1 ? -1 : 1);
      this.sweepPingPongAccum -= TAU;
    }
  }

  /**
   * Returns every cached intersection whose angle the playhead swept past
   * this frame.  Correctly handles the 2π → 0 wrap-around boundary.
   */
  checkAndFireCollisions(): CachedIntersection[] {
    // LEGACY: disabled 2026-04-21 — non-sweeper path only; sweepers use cluster-based
    // per-frame audio signals, not angle-crossing collisions.
    // To re-enable: un-comment this block.
    /*
    if (this.cachedIntersections.length === 0) return [];
    const prev = this.prevPlayheadAngle;
    const curr = this.playheadAngle;
    return this.cachedIntersections.filter(int =>
      curr >= prev
        ? int.angle >= prev && int.angle < curr
        : int.angle >= prev || int.angle < curr,
    );
    */
    return [];
  }

  /**
   * Spawn a new expanding-ring animation at a specific canvas point.
   * Revived 2026-06-07 for the discrete circle's crossing pulse — main.ts calls
   * this with each crossing's (x, y) as the playhead enters an occupied tick.
   */
  triggerAt(x: number, y: number): void {
    this.activeAnimations.push({ x, y, frame: 0, maxFrames: 18 });
  }

  /** Advance + prune all active trigger animations. Call once per rAF frame. */
  stepAnimations(): void {
    for (const anim of this.activeAnimations) anim.frame++;
    this.activeAnimations = this.activeAnimations.filter(a => a.frame < a.maxFrames);
  }

  // LEGACY: disabled 2026-04-21 — non-sweeper playhead-position helpers.
  // To re-enable: un-comment this block and restore non-sweeper ShapeTypes +
  // triangleEdges / rectEdges helpers above.
  /*
  private getPlayheadPosition(): Point {
    switch (this.type) {
      case 'circle':
        return {
          x: this.x + this.size * Math.cos(this.playheadAngle),
          y: this.y + this.size * Math.sin(this.playheadAngle),
        };
      case 'triangle':
        return this.rayToEdge(this.playheadAngle, this.triangleEdges());
      case 'rectangle':
        return this.rayToEdge(this.playheadAngle, this.rectEdges());
      case 'sweeper':
        return { x: this.x, y: this.y }; // unreachable — drawPlayhead() returns early
    }
  }

  private rayToEdge(angle: number, edges: [Point, Point][]): Point {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let bestT  = Infinity;
    let result: Point = { x: this.x, y: this.y };

    for (const [a, b] of edges) {
      const ex  = b.x - a.x,  ey  = b.y - a.y;
      const det = dx * ey - dy * ex;
      if (Math.abs(det) < 1e-10) continue;

      const fx = a.x - this.x, fy = a.y - this.y;
      const t  = (fx * ey - fy * ex) / det;
      const u  = (fx * dy - fy * dx) / det;

      if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < bestT) {
        bestT  = t;
        result = { x: this.x + t * dx, y: this.y + t * dy };
      }
    }
    return result;
  }
  */

  // ── Sweeper cluster computation ───────────────────────────────────────────

  /**
   * Core clustering logic for a single ray angle.
   * Used by both the live per-frame renderer and the 60-tick pre-builder.
   */
  private _clustersAtAngle(
    angle:     number,
    linkLines: { p1: Point; p2: Point }[],
    maxR:      number,
  ): SweepCluster[] {
    // 1. Collect (distance, line-angle) pairs of all ray-segment hits within maxR.
    //    Line angle is preserved so the final cluster can expose angleVariance.
    const hits: { dist: number; lineAngle: number }[] = [];
    const origin: Point = { x: this.x, y: this.y };
    for (const line of linkLines) {
      const t = getRaySegmentDist(origin, angle, line.p1, line.p2);
      if (t !== null && t <= maxR) {
        hits.push({
          dist: t,
          lineAngle: Math.atan2(line.p2.y - line.p1.y, line.p2.x - line.p1.x),
        });
      }
    }
    if (hits.length === 0) return [];

    // 2. Sort ascending by distance
    hits.sort((a, b) => a.dist - b.dist);

    // 3. Greedy 1D clustering on distance, carrying line-angle along.
    const groups: { dist: number; lineAngle: number }[][] = [];
    for (const h of hits) {
      const last = groups[groups.length - 1];
      if (last !== undefined && h.dist - last[last.length - 1].dist <= SWEEP_CLUSTER_THRESHOLD) {
        last.push(h);
      } else {
        groups.push([h]);
      }
    }

    // 4. Top-K by density, then re-sort by ascending distance for stable index→freq assignment
    const avgDist = (g: { dist: number }[]): number =>
      g.reduce((s, v) => s + v.dist, 0) / g.length;
    const topK = groups
      .sort((a, b) => b.length - a.length)   // primary: highest density first
      .slice(0, this.k)
      .sort((a, b) => avgDist(a) - avgDist(b)); // secondary: nearest cluster → f0

    // 5. Map to SweepCluster objects
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return topK.map(group => {
      const d = avgDist(group);
      return {
        distance: d,
        density:  group.length,
        x:        this.x + cos * d,
        y:        this.y + sin * d,
        freq:     this.freqLow + (d / maxR) * (this.freqHigh - this.freqLow),
        gain:     0.6 + Math.min(group.length / 20, 1.0) * 0.3,  // 0.6–0.9
        angleVariance: angleStdev(group.map(h => h.lineAngle)),
      };
    });
  }

  /**
   * Recompute this.sweepClusters from the current playheadAngle.
   * For multi-arm sweepers all N arm angles are computed; results are
   * accumulated into a single flat array for the live-blip renderer.
   * Called every animation frame.
   */
  computeSweepClusters(
    linkLines: { p1: Point; p2: Point }[],
    maxR:      number,
  ): void {
    this.sweepMaxR = maxR;
    const armSpacing = (Math.PI * 2) / this.sweepCount;
    this.sweepClusters = [];
    for (let arm = 0; arm < this.sweepCount; arm++) {
      const angle = (this.playheadAngle + arm * armSpacing) % (Math.PI * 2);
      this.sweepClusters.push(...this._clustersAtAngle(angle, linkLines, maxR));
    }
  }

  /**
   * Pre-compute clusters for all arms × 60 tick positions.
   * sweepTicks[armIdx][tickIdx] = SweepCluster[].
   * Call when: shape spawned, linkLines rebuilt (sample rate / resize),
   *            startAngle changes, k changes, or sweepCount changes.
   */
  rebuildSweepTicks(
    linkLines: { p1: Point; p2: Point }[],
    maxR:      number,
  ): void {
    this.sweepMaxR = maxR;
    const TICKS      = this.ticks;
    const step       = (Math.PI * 2) / TICKS;
    const armSpacing = (Math.PI * 2) / this.sweepCount;
    this.sweepTicks  = Array.from({ length: this.sweepCount }, (_, arm) =>
      Array.from({ length: TICKS }, (_, i) => {
        const angle = (this.startAngle + arm * armSpacing + i * step) % (Math.PI * 2);
        return this._clustersAtAngle(angle, linkLines, maxR);
      })
    );
  }

  /**
   * Discrete-probe analogue of rebuildSweepTicks (circle only).
   *
   * Where a sweeper casts a ray outward and clusters hits by distance, a
   * discrete probe owns a CLOSED PERIMETER: each orbital link-line crosses it
   * at up to two points. We bin those crossings by their polar angle (so the
   * angular playhead reaches them at the matching tick) into the SAME
   * `sweepTicks[arm][tick][slot]` structure the sweeper pipeline consumes —
   * `arm` is always 0 (one playhead). Empty ticks → silence → rhythm.
   *
   * Per-cluster `distance` is the crossing's distance to the SUN (not to the
   * shape centre, which on a circle is the constant radius and carries no
   * information), so `data.distance-to-sun` drives a pitch that varies as the
   * circle moves. `freq`/`gain` are filled for the base `toStrudelCode()`
   * fallback (gain-gated rhythm); the node-graph path reads distance/collision.
   *
   * Call when: shape spawned, moved, resized, or linkLines rebuilt.
   */
  bakeDiscreteTicks(
    linkLines: { p1: Point; p2: Point }[],
    sun:       Point,
    maxR:      number,
  ): void {
    this.sweepMaxR  = maxR;
    this.sweepCount = 1;
    const TICKS = this.ticks;
    const step  = (Math.PI * 2) / TICKS;
    const denom = maxR > 0 ? maxR : 1;
    const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

    const bins: SweepCluster[][] = Array.from({ length: TICKS }, () => []);
    for (const line of linkLines) {
      for (const pt of this.getIntersections(line)) {
        const raw   = Math.atan2(pt.y - this.y, pt.x - this.x);
        const theta = raw < 0 ? raw + Math.PI * 2 : raw;
        // Tick i is the angular bin whose centre (startAngle + i*step) is
        // nearest theta — mirrors the sweeper tick→angle mapping so visual
        // playhead and audio tick stay aligned.
        let i = Math.round((theta - this.startAngle) / step);
        i = ((i % TICKS) + TICKS) % TICKS;
        const distToSun = Math.hypot(pt.x - sun.x, pt.y - sun.y);
        bins[i].push({
          distance:      distToSun,
          density:       1,
          x:             pt.x,
          y:             pt.y,
          freq:          this.freqLow + clamp01(distToSun / denom) * (this.freqHigh - this.freqLow),
          gain:          0.7,
          angleVariance: 0,
        });
      }
    }
    // Nearest-sun crossing first, so slot k maps to a stable pitch ordering.
    for (const bin of bins) bin.sort((a, b) => a.distance - b.distance);
    this.sweepTicks        = [bins];
    this.intersectionCount = bins.reduce((n, b) => n + b.length, 0);
  }

  // ── Rhythm string + Strudel code generation ──────────────────────────────

  /**
   * Sweeper-only stub: returns an empty rhythm grid. Sweepers have no
   * @rhythm-N markers, so telemetry's patchRhythm() regex never matches and
   * this value is never embedded in the running code.
   *
   * LEGACY: disabled 2026-04-21 — the original binary-grid generator mapped
   * cachedIntersections onto a RHYTHM_STEPS-wide struct(), used by
   * drum/synth/key/bass templates. To re-enable: restore the body below.
   */
  generateRhythmString(): string {
    return '[~]';
    /*
    const grid: string[] = new Array(RHYTHM_STEPS).fill('~');
    for (const int of this.cachedIntersections) {
      const step = Math.floor((int.angle / (Math.PI * 2)) * RHYTHM_STEPS) % RHYTHM_STEPS;
      grid[step] = '1';
    }
    const rows = Array.from({ length: Math.ceil(grid.length / 16) }, (_, i) =>
      grid.slice(i * 16, i * 16 + 16).join(' ')
    );
    return `[${rows.join('\n  ')}]`;
    */
  }

  /**
   * Produce executable Strudel code for this shape.
   *
   * Structure (each block has stable markers for surgical regex updates):
   *
   *   // @shape-start-N
   *   // [Type N: r=XX, ∩=YY, s="instrument"]
   *   const r_N = "[~ ~ 1 ~ ...]"; // @rhythm-N    ← surgical patch target
   *   <pattern>.p((N).toString())
   *   // @shape-end-N
   *
   * The @rhythm-N marker lets main.ts patch ONLY the rhythm string when
   * the shape resizes or the sample rate changes, preserving user edits
   * to the pattern line below.
   *
   * The @shape-start/end markers let main.ts replace the entire block
   * when the instrument changes (since the pattern template changes too).
   */
  toStrudelCode(): string {
    // Only sweepers are active in this unit.
    return this._toSweeperCode();
    // LEGACY: disabled 2026-04-21 — per-instrument Strudel templates for
    // drum / bass / key / synth non-sweeper shapes.
    // To re-enable: un-comment the block below, restore DRUM_INSTRUMENTS /
    // KEY_INSTRUMENTS / BASS_INSTRUMENTS sets and generateRhythmString().
    /*
    if (this.type === 'sweeper') return this._toSweeperCode();
    const typeName = this.type.charAt(0).toUpperCase() + this.type.slice(1);
    const r        = Math.round(this.size);
    const n        = this.intersectionCount;
    const comment  = `// [${typeName} ${this.id}: r=${r}, \u2229=${n}, s="${this.instrument}"]`;

    const v            = `r_${this.id}`;
    const rhythm       = this.generateRhythmString();
    const rhythmMarker = `// @rhythm-${this.id}`;
    const startMarker  = `// @shape-start-${this.id}`;
    const endMarker    = `// @shape-end-${this.id}`;

    const pat = DRUM_INSTRUMENTS.has(this.instrument)
      ? `s("${this.instrument}")\n  .struct(${v})\n  .gain(0.8)`
      : BASS_INSTRUMENTS.has(this.instrument)
        ? `note("c1 e1 g1")\n  .s("${this.instrument}")\n  .struct(${v})\n  .octave(1)\n  .decay(1.8)\n  .sustain(0.7)\n  .gain(0.9)`
        : KEY_INSTRUMENTS.has(this.instrument)
          ? `note("c4 e4 g4 b4")\n  .s("${this.instrument}")\n  .struct(${v})\n  .velocity(0.6)\n  .decay(.5)\n  .sustain(.2)`
          : `note("c3 e3 g3 b3")\n  .s("${this.instrument}")\n  .struct(${v})\n  .lpf(1200)\n  .decay(.3)\n  .sustain(.1)\n  .gain(0.5)`;

    return [
      startMarker,
      comment,
      `const ${v} = \`${rhythm}\`; ${rhythmMarker}`,
      `${pat}\n  .p((${this.id}).toString())`,
      endMarker,
    ].join('\n');
    */
  }

  /**
   * Generates sweepCount × k stacked synth patterns using 60 pre-computed tick values.
   *
   * One Strudel cycle = one full sweep rotation (CPS = CPM/60, period = 60/CPM s).
   * With 60 steps, each step fires at exactly one of the 60 clock-face tick positions.
   * Arms are evenly spaced; each arm contributes k tones via .stack().
   */
  private _toSweeperCode(): string {
    const startMarker = `// @shape-start-${this.id}`;
    const endMarker   = `// @shape-end-${this.id}`;
    const deg         = (this.startAngle * 180 / Math.PI).toFixed(1);
    const armLabel    = this.sweepCount > 1 ? `, arms=${this.sweepCount}` : '';
    const typeLabel   = this.type === 'circle' ? 'Circle' : 'Sweeper';
    // instrument is a Generator selection key (e.g. 'sig1'); resolve to the
    // Strudel oscillator so the baked code emits a valid `s("sine")`.
    const osc         = resolveOscillator(this.instrument);
    const comment     = `// [${typeLabel} ${this.id}: k=${this.k}${armLabel}, s="${osc}", 12o'clock=${deg}°]`;

    // Formats a value array into 8-per-line chunks for textarea readability.
    // Strudel mini-notation treats all whitespace (including \n) as separators.
    const fmt = (vals: string[]): string =>
      Array.from({ length: Math.ceil(vals.length / 8) }, (_, i) =>
        vals.slice(i * 8, i * 8 + 8).join(' ')
      ).join('\n    ');

    // Build tones for each arm × each k cluster slot.
    // sweepTicks[armIdx][tickIdx][clusterSlot]
    const allTones: string[] = [];
    for (let arm = 0; arm < this.sweepCount; arm++) {
      const armTicks = this.sweepTicks[arm] ?? [];
      if (armTicks.length === 0) {
        // fallback: silent tones for this arm
        for (let ki = 0; ki < this.k; ki++) {
          allTones.push(`freq(440).gain(0).s("${osc}")`);
        }
        continue;
      }
      for (let ki = 0; ki < this.k; ki++) {
        const freqVals = armTicks.map(clusters => {
          const c = clusters[ki];
          return c ? c.freq.toFixed(1) : '0';
        });
        const gainVals = armTicks.map(clusters => {
          const c = clusters[ki];
          return c ? c.gain.toFixed(3) : '0';
        });
        allTones.push(`freq(\`${fmt(freqVals)}\`)\n  .gain(\`${fmt(gainVals)}\`)\n  .s("${osc}")`);
      }
    }

    if (allTones.length === 0) {
      allTones.push(`freq(440).gain(0).s("${osc}")`);
    }

    // Stack all tones; use (id).toString() to avoid transpiler string conversion
    const pat = allTones[0]
      + allTones.slice(1).map(t => `.stack(\n  ${t}\n)`).join('')
      + `\n  .p((${this.id}).toString())`;

    return [startMarker, comment, pat, endMarker].join('\n');
  }

  /** Tick index the playhead currently occupies (floor semantics — the
   *  interval Strudel is sounding NOW, mirroring main.ts's circle logic). */
  currentTick(): number {
    const TICKS = this.sweepTicks[0]?.length ?? this.ticks;
    if (TICKS <= 0) return 0;
    const step = (Math.PI * 2) / TICKS;
    let tick = Math.floor((this.playheadAngle - this.startAngle) / step);
    tick = ((tick % TICKS) + TICKS) % TICKS;
    return tick;
  }

  /**
   * Held (CONTEXT.md): the current tick's slots as sustained constant voices
   * — a chord frozen out of the rotation. Stays inside Strudel so the held
   * probe keeps its Generator sound (ADR 0003's boundary: probe audio never
   * leaves Strudel). Swapped in/out of the live code via replaceShapeBlock;
   * the original block is saved and restored verbatim by controls.toggleHold.
   */
  toHeldStrudelCode(): string {
    const startMarker = `// @shape-start-${this.id}`;
    const endMarker   = `// @shape-end-${this.id}`;
    const osc  = resolveOscillator(this.instrument);
    const tick = this.currentTick();
    const voices: string[] = [];
    for (let arm = 0; arm < this.sweepCount; arm++) {
      const armTicks = this.sweepTicks[arm] ?? [];
      if (armTicks.length === 0) continue;
      // Arms are evenly spaced; each arm reads its own offset tick.
      const armTick = (tick + Math.round(arm * armTicks.length / this.sweepCount))
        % armTicks.length;
      for (const c of armTicks[armTick] ?? []) {
        voices.push(
          `freq(${c.freq.toFixed(1)}).gain(${c.gain.toFixed(3)})`
          + `.attack(0.05).sustain(1).release(0.3).s("${osc}")`,
        );
      }
    }
    if (voices.length === 0) voices.push(`freq(440).gain(0).s("${osc}")`);
    const pat = voices[0]
      + voices.slice(1).map(v => `.stack(\n  ${v}\n)`).join('')
      + `\n  .p((${this.id}).toString())`;
    const comment = `// [Sweeper ${this.id}: HELD at tick ${tick}]`;
    return [startMarker, comment, pat, endMarker].join('\n');
  }
}
