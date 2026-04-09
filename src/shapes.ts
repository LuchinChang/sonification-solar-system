// src/shapes.ts
//
// Strict TypeScript model for every user-placed shape on the orbital canvas.
// Contains: geometry, hit-testing, playhead timing, collision detection,
//           trigger animations, and Strudel code generation.
// Audio (Strudel) is intentionally NOT wired here — code generation only.

import type { Point } from './geometry';
import { getLineCircleIntersections, getRaySegmentDist, pointToSegmentDist } from './geometry';
import type { ShapeConfig } from './config-snapshot';

// ── Public types ──────────────────────────────────────────────────────────────

export type ShapeType   = 'circle' | 'triangle' | 'rectangle' | 'sweeper';
export type PlaybackMode = 'constant-time' | 'constant-speed';

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
}

/** Resolution of the binary rhythm grid (angular bins mapped to Strudel struct). */
export const RHYTHM_STEPS = 256;

// ── Instrument classification ────────────────────────────────────────────────
// Used to choose the right Strudel code template and accent colour.

const DRUM_INSTRUMENTS = new Set(['bd', 'sd', 'hh', 'cp']);
const KEY_INSTRUMENTS  = new Set(['superpiano']);
const BASS_INSTRUMENTS = new Set(['gm_acoustic_bass']);
// Synths (sawtooth, sine, triangle, square, fm, …) → everything else

export function isDrum(instrument: string): boolean {
  return DRUM_INSTRUMENTS.has(instrument);
}

// ── Module-private types ──────────────────────────────────────────────────────

interface TriggerAnimation {
  x: number;
  y: number;
  frame: number;
  maxFrames: number;
}

// ── Sweeper constants ─────────────────────────────────────────────────────────
/** Max gap (px) between sorted distances before starting a new cluster. */
const SWEEP_CLUSTER_THRESHOLD = 2;
/** Accent colour for sweeper shapes. */
const SWEEP_COLOR = '#2DD4BF';  // teal

// ── Module-level ID counter ───────────────────────────────────────────────────
let _nextId = 0;

/** Reset the auto-increment ID counter (used when restoring a saved config). */
export function resetNextId(n: number): void { _nextId = n; }

// ── Internal geometry helpers ─────────────────────────────────────────────────

/** Finite line-segment intersection, or null when parallel/non-overlapping. */
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
  /** Intersection count — kept up-to-date by rebuildIntersectionCache(). */
  intersectionCount: number;
  /** Live clusters recomputed every frame (sweeper only). Flat across all arms. */
  sweepClusters: SweepCluster[];
  /**
   * Pre-computed clusters indexed [armIdx][tickIdx].
   * Rebuilt on geometry change (sample rate / resize / startAngle / k / sweepCount / ticks).
   */
  sweepTicks: SweepCluster[][][];

  constructor(x: number, y: number, type: ShapeType, size = 60) {
    this.id                  = ++_nextId;
    this.x                   = x;
    this.y                   = y;
    this.type                = type;
    this.instrument          = type === 'sweeper' ? 'sine' : 'bd';  // sweeper defaults to sine
    this.size                = size;
    this.isSelected          = false;
    this.playheadAngle       = 3 * Math.PI / 2;  // 12 o'clock, stays in [0, 2π)
    this.prevPlayheadAngle   = 3 * Math.PI / 2;
    this.cachedIntersections = [];
    this.activeAnimations    = [];
    this.intersectionCount   = 0;
    this.k                   = 4;
    this.sweepCount          = 1;
    this.sweepClusters       = [];
    this.startAngle          = 3 * Math.PI / 2;  // 90° math = UP = 12 o'clock
    this.ticks               = 60;
    this.sweepTicks          = [];
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /** Serialize to the portable config format (ShapeConfig). */
  toConfig(): ShapeConfig {
    const base: ShapeConfig = {
      id: this.id, type: this.type, x: this.x, y: this.y,
      size: this.size, instrument: this.instrument,
    };
    if (this.type === 'sweeper') {
      base.k          = this.k;
      base.sweepCount = this.sweepCount;
      base.startAngle = this.startAngle;
      base.ticks      = this.ticks;
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
    switch (this.type) {
      case 'circle':
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        break;
      case 'triangle':
        this.pathTriangle(ctx);
        break;
      case 'rectangle':
        ctx.rect(
          this.x - this.size, this.y - this.size * 0.6,
          this.size * 2,      this.size * 1.2,
        );
        break;
      case 'sweeper': {
        // Draw all N arms evenly spaced around the pivot
        const armSpacing = (Math.PI * 2) / this.sweepCount;
        for (let arm = 0; arm < this.sweepCount; arm++) {
          const angle = (this.playheadAngle + arm * armSpacing) % (Math.PI * 2);
          const ex = this.x + this.size * Math.cos(angle);
          const ey = this.y + this.size * Math.sin(angle);
          ctx.moveTo(this.x, this.y);
          ctx.lineTo(ex, ey);
        }
        break;
      }
    }
    ctx.stroke();

    // Static pre-computed tick dots — faint background showing the full sweep pattern
    if (this.type === 'sweeper' && this.sweepTicks.length > 0) {
      ctx.save();
      ctx.shadowBlur = 0;
      const TICKS      = this.ticks;
      const step       = (Math.PI * 2) / TICKS;
      const armSpacing = (Math.PI * 2) / this.sweepCount;
      for (let arm = 0; arm < this.sweepCount; arm++) {
        const armOffset = arm * armSpacing;
        const armTicks  = this.sweepTicks[arm] ?? [];
        for (let i = 0; i < armTicks.length; i++) {
          const angle = (this.startAngle + armOffset + i * step) % (Math.PI * 2);
          const cos   = Math.cos(angle);
          const sin   = Math.sin(angle);
          for (const c of armTicks[i]) {
            const tx = this.x + cos * c.distance;
            const ty = this.y + sin * c.distance;
            ctx.beginPath();
            ctx.arc(tx, ty, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(45, 212, 191, ${Math.min(c.gain * 0.35, 0.28)})`;
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    // Live radar blips at current arm position — opacity varies with density
    if (this.type === 'sweeper') {
      const maxDensity = this.sweepClusters.length > 0
        ? Math.max(...this.sweepClusters.map(c => c.density))
        : 1;

      for (const c of this.sweepClusters) {
        const alpha = Math.min(c.density / maxDensity, 1.0);
        const color = `rgba(45, 212, 191, ${Math.max(0.5, alpha)})`;

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
    if (this.type === 'sweeper') return; // the rotating line IS the playhead
    const pos = this.getPlayheadPosition();
    ctx.save();
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur  = 14;
    ctx.fillStyle   = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#FFFDE7';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Draws all live expanding-ring trigger animations. */
  drawAnimations(ctx: CanvasRenderingContext2D): void {
    if (this.activeAnimations.length === 0) return;
    ctx.save();
    for (const anim of this.activeAnimations) {
      const t      = anim.frame / anim.maxFrames;
      const radius = 5 + t * 18;
      ctx.globalAlpha  = (1 - t) * 0.80;
      ctx.strokeStyle  = '#F25C54';
      ctx.lineWidth    = 2.5 * (1 - t * 0.5);
      ctx.shadowColor  = '#F25C54';
      ctx.shadowBlur   = 12 * (1 - t);
      ctx.beginPath();
      ctx.arc(anim.x, anim.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private pathTriangle(ctx: CanvasRenderingContext2D): void {
    const h = this.size * Math.sqrt(3);
    ctx.moveTo(this.x,              this.y - h * 0.667);
    ctx.lineTo(this.x + this.size,  this.y + h * 0.333);
    ctx.lineTo(this.x - this.size,  this.y + h * 0.333);
    ctx.closePath();
  }

  // ── Accent colour — derived from instrument type ──────────────────────────

  get accentColor(): string {
    if (this.type === 'sweeper')               return SWEEP_COLOR;  // violet — sweeper
    if (DRUM_INSTRUMENTS.has(this.instrument)) return '#E8472C';    // coral  — drums
    if (KEY_INSTRUMENTS.has(this.instrument))  return '#E8A050';    // amber  — keys
    return '#C87A2E';                                               // copper — synths
  }

  // ── Hit-testing ───────────────────────────────────────────────────────────

  containsPoint(px: number, py: number): boolean {
    switch (this.type) {
      case 'circle':
        return Math.hypot(px - this.x, py - this.y) <= Math.max(this.size, 15);
      case 'triangle':
        return this.pointInTriangle({ x: px, y: py });
      case 'rectangle': {
        const hw = this.size, hh = this.size * 0.6;
        return px >= this.x - hw && px <= this.x + hw
            && py >= this.y - hh && py <= this.y + hh;
      }
      case 'sweeper': {
        // Selectable within 30px of origin OR within 8px of the rotating ray
        if (Math.hypot(px - this.x, py - this.y) <= 30) return true;
        const ex = this.x + this.size * Math.cos(this.playheadAngle);
        const ey = this.y + this.size * Math.sin(this.playheadAngle);
        return pointToSegmentDist(px, py, this.x, this.y, ex, ey) <= 8;
      }
    }
  }

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

  // ── Orbital line intersection ──────────────────────────────────────────────

  getIntersections(line: { p1: Point; p2: Point }): Point[] {
    switch (this.type) {
      case 'circle':
        return getLineCircleIntersections(line.p1, line.p2, this.x, this.y, this.size);
      case 'triangle':
        return this.edgeIntersections(line, this.triangleEdges());
      case 'rectangle':
        return this.edgeIntersections(line, this.rectEdges());
      case 'sweeper':
        return []; // sweeper uses computeSweepClusters() instead
    }
  }

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

  // ── Playhead system ───────────────────────────────────────────────────────

  /**
   * Pre-compute and cache every orbital intersection's polar angle + xy.
   * Must be called whenever: shape spawns, moves, resizes, or SAMPLE_RATE changes.
   * Also sets intersectionCount for the telemetry panel.
   */
  rebuildIntersectionCache(linkLines: { p1: Point; p2: Point }[]): void {
    if (this.type === 'sweeper') return; // sweeper intersections are dynamic per-frame
    this.cachedIntersections = [];
    for (const line of linkLines) {
      for (const pt of this.getIntersections(line)) {
        const raw   = Math.atan2(pt.y - this.y, pt.x - this.x);
        const angle = raw < 0 ? raw + Math.PI * 2 : raw;
        this.cachedIntersections.push({ angle, x: pt.x, y: pt.y });
      }
    }
    this.intersectionCount = this.cachedIntersections.length;
  }

  /**
   * Advance the playhead by one frame.
   * Constant Time  : all shapes share the same cycle duration regardless of size.
   * Constant Speed : cycle duration scales with size (fixed linear perimeter speed).
   */
  stepPlayhead(deltaMs: number, CPM: number, mode: PlaybackMode): void {
    if (deltaMs <= 0) return;
    const baseDuration = (60 / CPM) * 1000;
    const duration     = mode === 'constant-time'
      ? baseDuration
      : baseDuration * (this.size / 100);
    this.prevPlayheadAngle = this.playheadAngle;
    this.playheadAngle     = (this.playheadAngle + (deltaMs / duration) * Math.PI * 2)
                              % (Math.PI * 2);
  }

  /**
   * Returns every cached intersection whose angle the playhead swept past
   * this frame.  Correctly handles the 2π → 0 wrap-around boundary.
   */
  checkAndFireCollisions(): CachedIntersection[] {
    if (this.cachedIntersections.length === 0) return [];
    const prev = this.prevPlayheadAngle;
    const curr = this.playheadAngle;
    return this.cachedIntersections.filter(int =>
      curr >= prev
        ? int.angle >= prev && int.angle < curr
        : int.angle >= prev || int.angle < curr,
    );
  }

  /** Spawn a new expanding-ring animation at a specific canvas point. */
  triggerAt(x: number, y: number): void {
    this.activeAnimations.push({ x, y, frame: 0, maxFrames: 18 });
  }

  /** Advance + prune all active trigger animations. Call once per rAF frame. */
  stepAnimations(): void {
    for (const anim of this.activeAnimations) anim.frame++;
    this.activeAnimations = this.activeAnimations.filter(a => a.frame < a.maxFrames);
  }

  // ── Playhead position: maps angle → boundary point ────────────────────────

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
    // 1. Collect distances of all ray-segment hits within maxR
    const dists: number[] = [];
    const origin: Point = { x: this.x, y: this.y };
    for (const line of linkLines) {
      const t = getRaySegmentDist(origin, angle, line.p1, line.p2);
      if (t !== null && t <= maxR) dists.push(t);
    }
    if (dists.length === 0) return [];

    // 2. Sort ascending
    dists.sort((a, b) => a - b);

    // 3. Greedy 1D clustering
    const groups: number[][] = [];
    for (const d of dists) {
      const last = groups[groups.length - 1];
      if (last !== undefined && d - last[last.length - 1] <= SWEEP_CLUSTER_THRESHOLD) {
        last.push(d);
      } else {
        groups.push([d]);
      }
    }

    // 4. Top-K by density, then re-sort by ascending distance for stable index→freq assignment
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const topK = groups
      .sort((a, b) => b.length - a.length)   // primary: highest density first
      .slice(0, this.k)
      .sort((a, b) => avg(a) - avg(b));       // secondary: nearest cluster → f0

    // 5. Map to SweepCluster objects
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return topK.map(group => {
      const avgDist = avg(group);
      return {
        distance: avgDist,
        density:  group.length,
        x:        this.x + cos * avgDist,
        y:        this.y + sin * avgDist,
        freq:     100 + (avgDist / maxR) * 900,            // 100–1000 Hz
        gain:     0.6 + Math.min(group.length / 20, 1.0) * 0.3,  // 0.6–0.9
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

  // ── Rhythm string + Strudel code generation ──────────────────────────────

  /**
   * Map cached intersection angles onto a fixed-width binary grid.
   * Each '1' marks a step where the playhead crosses an orbital line;
   * '~' is silence.  The result is valid Strudel mini-notation for `struct()`.
   */
  generateRhythmString(): string {
    const grid: string[] = new Array(RHYTHM_STEPS).fill('~');
    for (const int of this.cachedIntersections) {
      const step = Math.floor((int.angle / (Math.PI * 2)) * RHYTHM_STEPS) % RHYTHM_STEPS;
      grid[step] = '1';
    }
    // Format as 16 tokens per line → 16×16 square grid for readability.
    // Strudel mini-notation treats newlines as whitespace separators.
    const rows = Array.from({ length: Math.ceil(grid.length / 16) }, (_, i) =>
      grid.slice(i * 16, i * 16 + 16).join(' ')
    );
    return `[${rows.join('\n  ')}]`;
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

    // Instrument-driven template:
    // • Drums  → percussive single-note hit
    // • Synths → 4-note chord arpeggio with low-pass filter
    // • Keys   → melodic chord with softer envelope
    //
    // NOTE: .p((id).toString()) is used instead of .p("id") because the
    // Strudel transpiler converts all string literals to m() Pattern objects,
    // but .p() expects a plain string key.  (id).toString() evaluates at
    // runtime without going through the transpiler.
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
    const comment     = `// [Sweeper ${this.id}: k=${this.k}${armLabel}, s="${this.instrument}", 12o'clock=${deg}°]`;

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
          allTones.push(`freq(440).gain(0).s("${this.instrument}")`);
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
        allTones.push(`freq(\`${fmt(freqVals)}\`)\n  .gain(\`${fmt(gainVals)}\`)\n  .s("${this.instrument}")`);
      }
    }

    if (allTones.length === 0) {
      allTones.push(`freq(440).gain(0).s("${this.instrument}")`);
    }

    // Stack all tones; use (id).toString() to avoid transpiler string conversion
    const pat = allTones[0]
      + allTones.slice(1).map(t => `.stack(\n  ${t}\n)`).join('')
      + `\n  .p((${this.id}).toString())`;

    return [startMarker, comment, pat, endMarker].join('\n');
  }
}
