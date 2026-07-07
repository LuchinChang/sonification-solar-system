// src/nodal-points.ts
//
// Nodal Point detection (CONTEXT.md): stationary points of the pattern
// figure, where consecutive link lines intersect and that intersection
// momentarily stops moving — local maxima of Nodality = 1/(1+Δ). Direct port
// of the 2019 CubeFest nodality.js, batched over one closed pattern cycle
// instead of streamed frame-by-frame. Pure math — no DOM, no audio.

import type { LinkLine } from './engine';

export interface NodalPoint {
  x: number;
  y: number;
  /** Polar angle around the pattern centre, degrees 0..360 (canvas coords). */
  angleDeg: number;
  /** Distance from the pattern centre, px. */
  radius: number;
  /** Peak nodality of the cluster this point summarises (0..1]. */
  nodality: number;
}

/** Intersection of two segments, or null (parallel / outside either segment). */
export function segmentIntersection(
  a: LinkLine, b: LinkLine,
): { x: number; y: number } | null {
  const s1x = a.p2.x - a.p1.x, s1y = a.p2.y - a.p1.y;
  const s2x = b.p2.x - b.p1.x, s2y = b.p2.y - b.p1.y;
  const denom = -s2x * s1y + s1x * s2y;
  if (Math.abs(denom) < 1e-12) return null;
  const s = (-s1y * (a.p1.x - b.p1.x) + s1x * (a.p1.y - b.p1.y)) / denom;
  const t = ( s2x * (a.p1.y - b.p1.y) - s2y * (a.p1.x - b.p1.x)) / denom;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  return { x: a.p1.x + t * s1x, y: a.p1.y + t * s1y };
}

/** Indices of strict cyclic local maxima (> both neighbours, mod length). */
export function cyclicLocalMaxima(values: number[]): number[] {
  const n = values.length;
  if (n < 3) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = values[(i - 1 + n) % n];
    const next = values[(i + 1) % n];
    if (values[i] > prev && values[i] > next) out.push(i);
  }
  return out;
}

interface Candidate { x: number; y: number; nodality: number; }

/** Nodality trace over the closed line sequence → local-max candidates. */
function nodalityCandidates(lines: LinkLine[]): Candidate[] {
  const n = lines.length;
  const inter: ({ x: number; y: number } | null)[] = new Array(n).fill(null);
  const nod: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    // Consecutive pair (i-1, i), cyclic so the figure's closure is honoured.
    inter[i] = segmentIntersection(lines[(i - 1 + n) % n], lines[i]);
  }
  for (let i = 0; i < n; i++) {
    const cur = inter[i];
    const prev = inter[(i - 1 + n) % n];
    if (cur !== null && prev !== null) {
      const d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      nod[i] = 1 / (1 + d);
    } // else stays 0 — a gap resets the chain, as in nodality.js
  }
  return cyclicLocalMaxima(nod)
    .filter(i => inter[i] !== null)
    .map(i => ({ x: inter[i]!.x, y: inter[i]!.y, nodality: nod[i] }));
}

interface Cluster { x: number; y: number; peak: number; weight: number; }

/** Greedy clustering: candidates within eps of a cluster centroid merge in. */
function clusterCandidates(cands: Candidate[], eps: number): Cluster[] {
  const clusters: Cluster[] = [];
  // Strongest first so cluster seeds sit on the sharpest maxima.
  for (const c of [...cands].sort((a, b) => b.nodality - a.nodality)) {
    const hit = clusters.find(k => Math.hypot(k.x - c.x, k.y - c.y) < eps);
    if (hit) {
      // Nodality-weighted running centroid.
      const w = hit.weight + c.nodality;
      hit.x = (hit.x * hit.weight + c.x * c.nodality) / w;
      hit.y = (hit.y * hit.weight + c.y * c.nodality) / w;
      hit.weight = w;
      hit.peak = Math.max(hit.peak, c.nodality);
    } else {
      clusters.push({ x: c.x, y: c.y, peak: c.nodality, weight: c.nodality });
    }
  }
  return clusters;
}

/**
 * Find the pattern's dominant ring of Nodal Points.
 * `lines` must be time-ordered over one closed cycle (computePatternLines
 * output). `expectedCount` is the pattern's petal count (|m−k|). `size` is
 * the sampling square's edge (sets clustering eps). May return fewer points
 * than expected for degenerate figures — callers must not assume the count.
 */
export function findNodalPoints(
  lines: LinkLine[],
  cx: number,
  cy: number,
  expectedCount: number,
  size: number,
): NodalPoint[] {
  if (lines.length < 3 || expectedCount <= 0) return [];
  const clusters = clusterCandidates(nodalityCandidates(lines), 0.04 * size);
  if (clusters.length === 0) return [];

  // Dominant ring: band clusters by radius, keep the band with the highest
  // summed peak nodality (prevents mixing two concentric rings).
  const withPolar = clusters.map(k => ({
    ...k,
    radius: Math.hypot(k.x - cx, k.y - cy),
    angleDeg: ((Math.atan2(k.y - cy, k.x - cx) * 180 / Math.PI) + 360) % 360,
  }));
  const maxRadius = Math.max(...withPolar.map(k => k.radius), 1);
  const bandWidth = 0.1 * maxRadius;
  const bands = new Map<number, typeof withPolar>();
  for (const k of withPolar) {
    const band = Math.round(k.radius / bandWidth);
    if (!bands.has(band)) bands.set(band, []);
    bands.get(band)!.push(k);
  }
  let dominant: typeof withPolar = [];
  let bestScore = -1;
  for (const members of bands.values()) {
    const score = members.reduce((s, k) => s + k.peak, 0);
    if (score > bestScore) { bestScore = score; dominant = members; }
  }

  return dominant
    .sort((a, b) => b.peak - a.peak)
    .slice(0, expectedCount)
    .map(k => ({ x: k.x, y: k.y, angleDeg: k.angleDeg, radius: k.radius, nodality: k.peak }))
    .sort((a, b) => a.angleDeg - b.angleDeg);
}
