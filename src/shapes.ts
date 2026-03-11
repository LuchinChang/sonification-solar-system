// src/shapes.ts
//
// Strict TypeScript model for every user-placed shape on the orbital canvas.
// Contains: geometry, hit-testing, playhead timing, collision detection,
//           trigger animations, and Strudel code generation.
// Audio (Strudel) is intentionally NOT wired here — code generation only.

import type { Point } from './geometry';
import { getLineCircleIntersections, getRaySegmentDist } from './geometry';

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
const KEY_INSTRUMENTS  = new Set(['piano']);
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
const SWEEP_CLUSTER_THRESHOLD = 20;
/** Accent colour for sweeper shapes. */
const SWEEP_COLOR = '#2DD4BF';  // teal

// ── Module-level ID counter ───────────────────────────────────────────────────
let _nextId = 0;

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
  isSelected: boolean;

  // ── Playhead sequencer state ──────────────────────────────────
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
  /** Top-K clusters to track (sweeper only). */
  k: number;
  /** Live clusters recomputed every frame (sweeper only). */
  sweepClusters: SweepCluster[];

  constructor(x: number, y: number, type: ShapeType, size = 60) {
    this.id                  = ++_nextId;
    this.x                   = x;
    this.y                   = y;
    this.type                = type;
    this.instrument          = 'bd';   // default: bass drum
    this.size                = size;
    this.isSelected          = false;
    this.playheadAngle       = 0;
    this.prevPlayheadAngle   = 0;
    this.cachedIntersections = [];
    this.activeAnimations    = [];
    this.intersectionCount   = 0;
    this.k                   = 4;
    this.sweepClusters       = [];
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
        const ex = this.x + this.size * Math.cos(this.playheadAngle);
        const ey = this.y + this.size * Math.sin(this.playheadAngle);
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(ex, ey);
        break;
      }
    }
    ctx.stroke();

    // Radar blips — fixed size 3px, opacity varies with density
    if (this.type === 'sweeper') {
      const maxDensity = this.sweepClusters.length > 0
        ? Math.max(...this.sweepClusters.map(c => c.density))
        : 1;

      for (const c of this.sweepClusters) {
        const alpha = Math.min(c.density / maxDensity, 1.0);  // 0 to 1
        const color = `rgba(45, 212, 191, ${Math.max(0.3, alpha)})`;  // min 0.3, max 1.0

        ctx.beginPath();
        ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);  // fixed 3px radius
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.shadowBlur  = 4;  // reduced from 6
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
        return Math.hypot(px - this.x, py - this.y) <= this.size;
      case 'triangle':
        return this.pointInTriangle({ x: px, y: py });
      case 'rectangle': {
        const hw = this.size, hh = this.size * 0.6;
        return px >= this.x - hw && px <= this.x + hw
            && py >= this.y - hh && py <= this.y + hh;
      }
      case 'sweeper':
        // Selectable by clicking within 20px of its origin (the Sun)
        return Math.hypot(px - this.x, py - this.y) <= 20;
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
   * Recompute this.sweepClusters from the current playheadAngle.
   * Called every animation frame for 'sweeper' shapes.
   *
   * Algorithm:
   *   1. Ray-cast each link line against the sweeper ray → get distances.
   *   2. Sort distances ascending.
   *   3. Greedy 1D cluster: merge points within SWEEP_CLUSTER_THRESHOLD px.
   *   4. Keep Top-K clusters by density (line count).
   *   5. Map distance → freq (100–1000 Hz), density → gain (0.6–0.9).
   */
  computeSweepClusters(
    linkLines: { p1: Point; p2: Point }[],
    maxR:      number,
  ): void {
    // 1. Collect distances of all ray-segment hits within maxR
    const dists: number[] = [];
    const origin: Point = { x: this.x, y: this.y };
    for (const line of linkLines) {
      const t = getRaySegmentDist(origin, this.playheadAngle, line.p1, line.p2);
      if (t !== null && t <= maxR) dists.push(t);
    }

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

    // 4. Top-K by density
    const topK = groups
      .sort((a, b) => b.length - a.length)
      .slice(0, this.k);

    // 5. Map to SweepCluster objects
    const cos = Math.cos(this.playheadAngle);
    const sin = Math.sin(this.playheadAngle);
    this.sweepClusters = topK.map(group => {
      const avgDist = group.reduce((s, v) => s + v, 0) / group.length;
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
    return `[${grid.join(' ')}]`;
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
      ? `s("${this.instrument}").struct(${v}).gain(0.8)`
      : KEY_INSTRUMENTS.has(this.instrument)
        ? `note("c4 e4 g4 b4").s("${this.instrument}").struct(${v}).velocity(0.6).decay(.5).sustain(.2)`
        : `note("c3 e3 g3 b3").s("${this.instrument}").struct(${v}).lpf(1200).decay(.3).sustain(.1).gain(0.5)`;

    return [
      startMarker,
      comment,
      `const ${v} = "${rhythm}"; ${rhythmMarker}`,
      `${pat}.p((${this.id}).toString())`,
      endMarker,
    ].join('\n');
  }

  /**
   * Strudel code for the sweeper instrument.
   *
   * Generates k stacked sine patterns whose .freq() and .gain() read from
   * globalThis globals (e.g. globalThis.__sw_1_f0) updated each rAF frame
   * by main.ts.  signal() is available because evalScope loads @strudel/core
   * onto globalThis, registering it as a global function.
   *
   * This code is generated once and never surgically patched — the live
   * globals provide the continuous parameter updates without re-evaluation.
   */
  private _toSweeperCode(): string {
    const startMarker = `// @shape-start-${this.id}`;
    const endMarker   = `// @shape-end-${this.id}`;
    const comment     = `// [Sweeper ${this.id}: k=${this.k}, s="${this.instrument}"]`;

    // Choose sound based on instrument type
    const sound = this.instrument === 'sine' ? 's("sine")'
                : this.instrument === 'sawtooth' ? 's("sawtooth")'
                : this.instrument === 'square' ? 's("square")'
                : this.instrument === 'triangle' ? 's("triangle")'
                : this.instrument === 'fm' ? 's("fm")'
                : 's("sine")';  // fallback

    const tones = Array.from({ length: this.k }, (_, i) =>
      sound +
      `.freq(signal(() => (globalThis.__sw_${this.id}_f${i} ?? 0)))` +
      `.gain(signal(() => (globalThis.__sw_${this.id}_g${i} ?? 0)))`,
    );

    // Stack all k tones; use (id).toString() to avoid transpiler string conversion
    const pat = tones[0]
      + tones.slice(1).map(t => `.stack(${t})`).join('')
      + `.p((${this.id}).toString())`;

    return [startMarker, comment, pat, endMarker].join('\n');
  }
}
