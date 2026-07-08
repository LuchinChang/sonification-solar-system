# Nodal Chord + Timbre Playground + Sweeper Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the selector Preview finishes drawing, the pattern's Nodal Points breathe while an organ-style Nodal Chord sounds (one voice per symmetry lobe, pitched by the continuous Fifths Mapping, timbre from the pair's two resonance-locked sinusoids); a hidden playground drawer tunes it; independently, `H` holds a sweeper frozen while its current tick's voices sustain.

**Architecture:** Pure-math modules (`nodal-points.ts`, `fifths.ts`) feed a raw-WebAudio synth (`nodal-chord.ts`, per ADR 0003) routed through the existing compressor+mute chain. `pattern-preview.ts` becomes draw-once + glow overlay. The Sweeper Hold stays inside Strudel via block-swap in the telemetry textarea. Everything gated by `NODAL_CHORD_DEFAULT_ON || unlocked` (unlock: `?playground` or double-click the preview).

**Tech Stack:** TypeScript strict, Vitest, HTML5 Canvas, WebAudio (`PeriodicWave`, `OscillatorNode`, `GainNode`), Strudel (Hold only).

**Domain terms:** see CONTEXT.md — Nodal Point, Nodality, Fifths Mapping, Nodal Chord, Held (probe), Preview (draw-once). Decisions in ADR 0003.

**Key session decisions (from the grilling):**
- Nodal Point detection = port of `nodality.js` (consecutive link-line intersection, local max of `1/(1+Δ)`); chord size = `pattern.petals` (|m−k|), dominant radius band.
- Fifths Mapping: `semitones = 7·(θdeg/30)`, wrapped mod 12 (wrap is a knob), `f = f0·2^(semis/12)`, f0 default C4 261.63. Radius mapping knob: none (default) / gain / octave.
- Timbre: two partials at the pair's m:k resonance ratio (unlockable to free ratio), operator add / ring / fm, balance + phase + FM-index knobs.
- Chord: plays once when the draw completes; ~80ms attack, sustainMs (default 3000) with breathing, ~0.5s release; click preview = replay; any knob change retriggers; pair change / selector close stops it.
- Hold: `H` toggles the active sweeper; arm freezes, current tick's slots sustain via Strudel block swap; unhold restores the exact previous block and re-anchors the clock. Fifths Mapping NOT used here.
- Two-stage rollout: `NODAL_CHORD_DEFAULT_ON = false` until golden defaults are found.

---

### Task 1: `src/fifths.ts` — continuous Fifths Mapping (pure math)

**Files:**
- Create: `src/fifths.ts`
- Test: `src/__tests__/fifths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/fifths.test.ts
import { describe, it, expect } from 'vitest';
import {
  fifthsSemitones, fifthsFrequency, radiusGain, radiusOctaveFactor, DEFAULT_F0,
} from '../fifths';

describe('fifthsSemitones', () => {
  it('steps a perfect fifth (7 semitones) per 30° sector', () => {
    expect(fifthsSemitones(0)).toBe(0);
    expect(fifthsSemitones(30)).toBe(7);
    expect(fifthsSemitones(60)).toBeCloseTo(2, 10);  // 14 mod 12
    expect(fifthsSemitones(90)).toBeCloseTo(9, 10);  // 21 mod 12
  });
  it('is continuous, not snapped', () => {
    expect(fifthsSemitones(15)).toBeCloseTo(3.5, 10);
    expect(fifthsSemitones(1)).toBeCloseTo(7 / 30, 10);
  });
  it('normalizes angles outside 0..360', () => {
    expect(fifthsSemitones(390)).toBeCloseTo(fifthsSemitones(30), 10);
    expect(fifthsSemitones(-330)).toBeCloseTo(fifthsSemitones(30), 10);
  });
});

describe('fifthsFrequency', () => {
  it('returns f0 at 0° and a fifth above at 30°', () => {
    expect(fifthsFrequency(0)).toBeCloseTo(DEFAULT_F0, 6);
    expect(fifthsFrequency(30)).toBeCloseTo(DEFAULT_F0 * Math.pow(2, 7 / 12), 6);
  });
  it('wraps into one octave by default, spans octaves when wrap=false', () => {
    const wrapped = fifthsFrequency(60);
    expect(wrapped).toBeGreaterThanOrEqual(DEFAULT_F0);
    expect(wrapped).toBeLessThan(DEFAULT_F0 * 2);
    expect(fifthsFrequency(60, DEFAULT_F0, false))
      .toBeCloseTo(DEFAULT_F0 * Math.pow(2, 14 / 12), 6);
  });
});

describe('radius helpers', () => {
  it('radiusGain: closer to the Sun is louder, floor 0.5', () => {
    expect(radiusGain(0)).toBe(1);
    expect(radiusGain(1)).toBeCloseTo(0.5, 10);
  });
  it('radiusOctaveFactor: mid radius is unity, extremes are ±1 octave', () => {
    expect(radiusOctaveFactor(0.5)).toBeCloseTo(1, 10);
    expect(radiusOctaveFactor(0)).toBeCloseTo(2, 10);
    expect(radiusOctaveFactor(1)).toBeCloseTo(0.5, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/fifths.test.ts`
Expected: FAIL — cannot resolve `../fifths`.

- [ ] **Step 3: Write the implementation**

```ts
// src/fifths.ts
//
// The continuous Fifths Mapping (CONTEXT.md): a Nodal Point's polar angle
// around the Sun sets its pitch — a perfect fifth (7 semitones) per 30° of
// angle, wrapped into a single octave. Frequency is continuous, never snapped
// to the nearest semitone. Ported from the 2019 CubeFest kb.fifth.maxpat
// (angle → /30 → ×7 → mod 12), minus the integer snap.
// Pure math — no DOM, no audio.

export const SEMITONES_PER_SECTOR = 7;
export const SECTOR_DEG = 30;
/** Default chord root: middle C (the Max patch's octave-5 default = MIDI 60). */
export const DEFAULT_F0 = 261.63;

function norm360(angleDeg: number): number {
  return ((angleDeg % 360) + 360) % 360;
}

/** Continuous pitch class in semitones (0 ≤ s < 12) for a polar angle. */
export function fifthsSemitones(angleDeg: number): number {
  const s = (SEMITONES_PER_SECTOR * norm360(angleDeg)) / SECTOR_DEG;
  return ((s % 12) + 12) % 12;
}

/** Frequency for a polar angle. wrap=false spans the full 7 octaves. */
export function fifthsFrequency(angleDeg: number, f0 = DEFAULT_F0, wrap = true): number {
  const raw = (SEMITONES_PER_SECTOR * norm360(angleDeg)) / SECTOR_DEG;
  const semis = wrap ? ((raw % 12) + 12) % 12 : raw;
  return f0 * Math.pow(2, semis / 12);
}

/** radiusNorm 0..1 (distance from Sun / max radius) → voice gain 1..0.5. */
export function radiusGain(radiusNorm: number): number {
  const r = Math.min(Math.max(radiusNorm, 0), 1);
  return 1 - 0.5 * r;
}

/** radiusNorm 0..1 → frequency factor: inner points up to +1 octave, outer −1. */
export function radiusOctaveFactor(radiusNorm: number): number {
  const r = Math.min(Math.max(radiusNorm, 0), 1);
  return Math.pow(2, (0.5 - r) * 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/fifths.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fifths.ts src/__tests__/fifths.test.ts
git commit -m "feat: continuous Fifths Mapping module (angle→pitch, radius helpers)"
```

---

### Task 2: `src/nodal-points.ts` — Nodal Point detection (pure math)

**Files:**
- Create: `src/nodal-points.ts`
- Test: `src/__tests__/nodal-points.test.ts`

The detection pipeline (port of `nodality.js`, batched over one closed pattern cycle):
1. For each consecutive pair of link lines `(i−1, i)`, compute the segment intersection (skip when none / parallel).
2. Nodality of sample i = `1/(1+Δ)` where Δ = distance the intersection moved since the previous *existing* intersection (gaps reset the chain, as in `nodality.js`).
3. Candidates = cyclic local maxima of the nodality sequence (strictly greater than both cyclic neighbours).
4. Cluster candidates within `eps = 0.04·size`; each cluster gets a nodality-weighted centroid and a peak nodality.
5. Group clusters into radius bands (band width `0.1·maxRadius` around the canvas centre); pick the band with the highest total peak nodality (the dominant ring); return its top `expectedCount` clusters sorted by angle. (Contingency decided in review: band grouping prevents mixing two rings when a figure has several.)

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/nodal-points.test.ts
import { describe, it, expect } from 'vitest';
import {
  segmentIntersection, cyclicLocalMaxima, findNodalPoints,
} from '../nodal-points';
import { computePatternLines, PATTERNS } from '../patterns';

const seg = (x1: number, y1: number, x2: number, y2: number) =>
  ({ p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });

describe('segmentIntersection', () => {
  it('finds the crossing of two crossing segments', () => {
    const p = segmentIntersection(seg(0, 0, 10, 10), seg(0, 10, 10, 0));
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(5, 6);
    expect(p!.y).toBeCloseTo(5, 6);
  });
  it('returns null for parallel and for non-overlapping segments', () => {
    expect(segmentIntersection(seg(0, 0, 10, 0), seg(0, 5, 10, 5))).toBeNull();
    expect(segmentIntersection(seg(0, 0, 1, 1), seg(5, 0, 6, -1))).toBeNull();
  });
});

describe('cyclicLocalMaxima', () => {
  it('finds strict maxima, including across the wrap point', () => {
    expect(cyclicLocalMaxima([1, 3, 2, 1, 5, 1])).toEqual([1, 4]);
    expect(cyclicLocalMaxima([9, 1, 2, 3, 1, 2])).toEqual([0, 3]); // 9 beats both cyclic neighbours
  });
  it('ignores plateaus', () => {
    expect(cyclicLocalMaxima([1, 4, 4, 1, 0, 0])).toEqual([]);
  });
});

describe('findNodalPoints on the Pentagram of Venus', () => {
  const venusEarth = PATTERNS.find(p => p.id === 'venus-earth')!;
  const SIZE = 280;
  const lines = computePatternLines(venusEarth, SIZE, 1200);
  const pts = findNodalPoints(lines, SIZE / 2, SIZE / 2, venusEarth.petals, SIZE);

  it('finds exactly 5 nodal points (one per symmetry lobe)', () => {
    expect(pts.length).toBe(5);
  });
  it('spaces them ~72° apart around the Sun', () => {
    const angles = pts.map(p => p.angleDeg).sort((a, b) => a - b);
    for (let i = 0; i < 5; i++) {
      const next = angles[(i + 1) % 5] + (i === 4 ? 360 : 0);
      expect(next - angles[i]).toBeGreaterThan(72 - 8);
      expect(next - angles[i]).toBeLessThan(72 + 8);
    }
  });
  it('puts them on one ring (radii within 15% of each other)', () => {
    const radii = pts.map(p => p.radius);
    expect(Math.max(...radii) / Math.min(...radii)).toBeLessThan(1.15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/nodal-points.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/nodal-points.test.ts` → PASS.

**If the Venus-Earth integration test fails** (empirical geometry — counts/spacing may surprise): debug by dumping `clusterCandidates` output for the venus-earth lines (`console.log` in the test, `npx vitest run --reporter=verbose`). Knobs to adjust, in order: sampling density (1200 → 2000), eps fraction (0.04 → 0.03/0.06), band width (0.1 → 0.15). Do NOT loosen the test's 5-count assertion — the |m−k| ring is the domain decision; make detection meet it.

- [ ] **Step 5: Commit**

```bash
git add src/nodal-points.ts src/__tests__/nodal-points.test.ts
git commit -m "feat: Nodal Point detection — nodality.js port with ring clustering"
```

---

### Task 3: `src/playground-settings.ts` — settings model + persistence + gate

**Files:**
- Create: `src/playground-settings.ts`
- Test: `src/__tests__/playground-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/playground-settings.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, loadUnlocked, saveUnlocked,
  settingsAsCode, NODAL_CHORD_DEFAULT_ON,
} from '../playground-settings';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0,
  } as Storage;
}

describe('playground settings', () => {
  it('ships hidden until golden defaults are found', () => {
    expect(NODAL_CHORD_DEFAULT_ON).toBe(false);
  });
  it('returns defaults from empty storage', () => {
    expect(loadSettings(memStorage())).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips saved settings', () => {
    const s = memStorage();
    saveSettings(s, { ...DEFAULT_SETTINGS, operator: 'fm', f0: 220 });
    expect(loadSettings(s).operator).toBe('fm');
    expect(loadSettings(s).f0).toBe(220);
  });
  it('ignores corrupt JSON and unknown fields, clamps ranges', () => {
    const s = memStorage();
    s.setItem('nodal-playground-settings', '{nope');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    s.setItem('nodal-playground-settings',
      JSON.stringify({ f0: 99999, balance: -3, bogus: true }));
    const loaded = loadSettings(s);
    expect(loaded.f0).toBeLessThanOrEqual(1046.5);
    expect(loaded.balance).toBe(0);
    expect('bogus' in loaded).toBe(false);
  });
  it('persists the unlock flag', () => {
    const s = memStorage();
    expect(loadUnlocked(s)).toBe(false);
    saveUnlocked(s, true);
    expect(loadUnlocked(s)).toBe(true);
  });
  it('serialises current settings as a TS literal for promotion to defaults', () => {
    const code = settingsAsCode(DEFAULT_SETTINGS);
    expect(code).toContain("operator: 'add'");
    expect(code).toContain('f0: 261.63');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → module missing.

- [ ] **Step 3: Write the implementation**

```ts
// src/playground-settings.ts
//
// The timbre playground's settings model. ONE global settings object applies
// to every planet pair (decided 2026-07-06 — per-pair overrides are out of
// scope). Persistence is injected-storage like mute.ts. The playground and
// the Nodal Chord are hidden behind NODAL_CHORD_DEFAULT_ON || unlock; flip
// the constant once the golden defaults are found ("copy settings as code"
// serialises the current knobs for pasting into DEFAULT_SETTINGS).

export interface PlaygroundSettings {
  operator: 'add' | 'ring' | 'fm';
  /** 0..1 — share of partial 2 (the outer-orbit sinusoid). */
  balance: number;
  /** 0..360 — relative phase of partial 2 (audible for add+resonance only). */
  phaseDeg: number;
  /** 0..10 — FM modulation index (fm operator only). */
  fmIndex: number;
  ratioMode: 'resonance' | 'free';
  /** 0.25..4 — partial-2/partial-1 ratio when ratioMode is 'free'. */
  freeRatio: number;
  /** 65.4..1046.5 Hz — chord root (Fifths Mapping f0). */
  f0: number;
  /** Wrap pitches into one octave above f0 (Fifths Mapping default). */
  wrapOctave: boolean;
  radiusMapping: 'none' | 'gain' | 'octave';
  /** 500..8000 ms — chord sustain before the fade. */
  sustainMs: number;
  /** 0..1 — chord master gain. */
  gain: number;
}

export const DEFAULT_SETTINGS: PlaygroundSettings = {
  operator: 'add',
  balance: 0.5,
  phaseDeg: 0,
  fmIndex: 2,
  ratioMode: 'resonance',
  freeRatio: 1.5,
  f0: 261.63,
  wrapOctave: true,
  radiusMapping: 'none',
  sustainMs: 3000,
  gain: 0.5,
};

/** Stage-1 gate: false while hunting golden defaults; flip to ship the chord. */
export const NODAL_CHORD_DEFAULT_ON = false;

export const PLAYGROUND_SETTINGS_KEY = 'nodal-playground-settings';
export const PLAYGROUND_UNLOCK_KEY = 'nodal-playground-unlocked';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

function sanitize(raw: Partial<PlaygroundSettings>): PlaygroundSettings {
  const d = DEFAULT_SETTINGS;
  return {
    operator: raw.operator === 'ring' || raw.operator === 'fm' ? raw.operator : d.operator,
    balance: typeof raw.balance === 'number' ? clamp(raw.balance, 0, 1) : d.balance,
    phaseDeg: typeof raw.phaseDeg === 'number' ? clamp(raw.phaseDeg, 0, 360) : d.phaseDeg,
    fmIndex: typeof raw.fmIndex === 'number' ? clamp(raw.fmIndex, 0, 10) : d.fmIndex,
    ratioMode: raw.ratioMode === 'free' ? 'free' : d.ratioMode,
    freeRatio: typeof raw.freeRatio === 'number' ? clamp(raw.freeRatio, 0.25, 4) : d.freeRatio,
    f0: typeof raw.f0 === 'number' ? clamp(raw.f0, 65.4, 1046.5) : d.f0,
    wrapOctave: typeof raw.wrapOctave === 'boolean' ? raw.wrapOctave : d.wrapOctave,
    radiusMapping: raw.radiusMapping === 'gain' || raw.radiusMapping === 'octave'
      ? raw.radiusMapping : d.radiusMapping,
    sustainMs: typeof raw.sustainMs === 'number' ? clamp(raw.sustainMs, 500, 8000) : d.sustainMs,
    gain: typeof raw.gain === 'number' ? clamp(raw.gain, 0, 1) : d.gain,
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'>): PlaygroundSettings {
  try {
    const raw = storage.getItem(PLAYGROUND_SETTINGS_KEY);
    if (raw === null) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw) as Partial<PlaygroundSettings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  storage: Pick<Storage, 'setItem'>, s: PlaygroundSettings,
): void {
  storage.setItem(PLAYGROUND_SETTINGS_KEY, JSON.stringify(s));
}

export function loadUnlocked(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(PLAYGROUND_UNLOCK_KEY) === 'true';
}

export function saveUnlocked(storage: Pick<Storage, 'setItem'>, v: boolean): void {
  storage.setItem(PLAYGROUND_UNLOCK_KEY, String(v));
}

/** Serialise settings as the DEFAULT_SETTINGS literal (promotion path). */
export function settingsAsCode(s: PlaygroundSettings): string {
  return [
    'export const DEFAULT_SETTINGS: PlaygroundSettings = {',
    `  operator: '${s.operator}',`,
    `  balance: ${s.balance},`,
    `  phaseDeg: ${s.phaseDeg},`,
    `  fmIndex: ${s.fmIndex},`,
    `  ratioMode: '${s.ratioMode}',`,
    `  freeRatio: ${s.freeRatio},`,
    `  f0: ${s.f0},`,
    `  wrapOctave: ${s.wrapOctave},`,
    `  radiusMapping: '${s.radiusMapping}',`,
    `  sustainMs: ${s.sustainMs},`,
    `  gain: ${s.gain},`,
    '};',
  ].join('\n');
}
```

- [ ] **Step 4: Run to verify it passes** → `npx vitest run src/__tests__/playground-settings.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/playground-settings.ts src/__tests__/playground-settings.test.ts
git commit -m "feat: playground settings model, persistence, unlock gate"
```

---

### Task 4: chord bus + `src/nodal-chord.ts` — raw-WebAudio synth (ADR 0003)

**Files:**
- Modify: `src/audio.ts` (chord bus getter; ~line 62 where the compressor is built)
- Create: `src/nodal-chord.ts`
- Test: `src/__tests__/nodal-chord.test.ts` (pure `chordVoices` only — the graph itself is E2E-verified in Task 9)

- [ ] **Step 1: Add the chord bus to audio.ts**

In `src/audio.ts`, next to `masterMuteGain` (line 18):

```ts
// ── Nodal Chord bus (ADR 0003) ──────────────────────────────────────────────
// Selector-local chord audio bypasses Strudel but shares the compressor +
// master-mute chain, so it respects global mute and needs no second gesture.
let chordBus: AudioNode | null = null;

/** Input node for raw-WebAudio chord voices; null before audio init. */
export function getChordBus(): AudioNode | null {
  return chordBus;
}
```

and inside `initializeAudio()`, right after `compressor.connect(masterMuteGain);` (line 73):

```ts
  chordBus = compressor;
```

- [ ] **Step 2: Write the failing test for the pure voice computation**

```ts
// src/__tests__/nodal-chord.test.ts
import { describe, it, expect } from 'vitest';
import { chordVoices } from '../nodal-chord';
import { DEFAULT_SETTINGS } from '../playground-settings';
import type { NodalPoint } from '../nodal-points';

const pt = (angleDeg: number, radius: number): NodalPoint =>
  ({ x: 0, y: 0, angleDeg, radius, nodality: 1 });

describe('chordVoices', () => {
  it('emits one voice per nodal point with resonance-locked ratio', () => {
    const v = chordVoices([pt(0, 50), pt(72, 50)], DEFAULT_SETTINGS,
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(v.length).toBe(2);
    expect(v[0].freq).toBeCloseTo(DEFAULT_SETTINGS.f0, 4);
    expect(v[0].ratio).toBeCloseTo(13 / 8, 10);
    expect(v[0].gain).toBe(1);
  });
  it('uses the free ratio when ratioMode is free', () => {
    const v = chordVoices([pt(0, 50)],
      { ...DEFAULT_SETTINGS, ratioMode: 'free', freeRatio: 2.5 },
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(v[0].ratio).toBe(2.5);
  });
  it('keeps wrapped pitches inside one octave of f0', () => {
    const v = chordVoices([pt(300, 50)], DEFAULT_SETTINGS,
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(v[0].freq).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.f0);
    expect(v[0].freq).toBeLessThan(DEFAULT_SETTINGS.f0 * 2);
  });
  it('applies radius→gain and radius→octave mappings', () => {
    const gainV = chordVoices([pt(0, 100)],
      { ...DEFAULT_SETTINGS, radiusMapping: 'gain' },
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(gainV[0].gain).toBeCloseTo(0.5, 6);
    const octV = chordVoices([pt(0, 0)],
      { ...DEFAULT_SETTINGS, radiusMapping: 'octave' },
      { innerOrbits: 13, outerOrbits: 8 }, 100);
    expect(octV[0].freq).toBeCloseTo(DEFAULT_SETTINGS.f0 * 2, 4);
  });
});
```

- [ ] **Step 3: Run to verify it fails** → module missing.

- [ ] **Step 4: Write the implementation**

```ts
// src/nodal-chord.ts
//
// Nodal Chord synthesis — deliberately raw WebAudio, NOT Strudel (ADR 0003:
// continuous un-snapped frequencies, ring-mod/FM operators, sustained organ
// envelopes, live knob response). Voices route through getChordBus() (the
// master compressor), so global mute and the single gesture-unlock apply.
//
// Timbre model: each voice is TWO partials — the pair's two orbital
// sinusoids — at frequency ratio m:k (the pattern's resonance) or a free
// ratio, combined by the chosen operator:
//   add  — PeriodicWave with harmonics k and m of fundamental f/k (phase knob
//          rotates partial 2); falls back to two summed oscillators in free
//          mode (no integer harmonics → no PeriodicWave, phase knob inert).
//   ring — carrier osc × modulator osc via a gain node (classic ring mod).
//   fm   — modulator drives carrier.frequency; deviation = fmIndex · f_mod.

import { getChordBus } from './audio';
import { fifthsFrequency, radiusGain, radiusOctaveFactor } from './fifths';
import type { NodalPoint } from './nodal-points';
import type { PlaygroundSettings } from './playground-settings';

export const CHORD_ATTACK_S = 0.08;
export const CHORD_RELEASE_S = 0.5;
/** Breathe: slow sinusoidal swell during sustain (audible AND visual). */
export const BREATHE_HZ = 0.4;
export const BREATHE_DEPTH = 0.12;

export interface VoiceSpec { freq: number; ratio: number; gain: number; }

export interface PairResonanceLike { innerOrbits: number; outerOrbits: number; }

/** Pure: nodal points + settings → per-voice frequency/ratio/gain. */
export function chordVoices(
  points: NodalPoint[],
  s: PlaygroundSettings,
  resonance: PairResonanceLike,
  maxRadius: number,
): VoiceSpec[] {
  const ratio = s.ratioMode === 'free'
    ? s.freeRatio
    : resonance.innerOrbits / resonance.outerOrbits;
  return points.map(p => {
    let freq = fifthsFrequency(p.angleDeg, s.f0, s.wrapOctave);
    let gain = 1;
    const rn = maxRadius > 0 ? p.radius / maxRadius : 0;
    if (s.radiusMapping === 'gain') gain = radiusGain(rn);
    if (s.radiusMapping === 'octave') freq *= radiusOctaveFactor(rn);
    return { freq, ratio, gain };
  });
}

// ── Live chord state ─────────────────────────────────────────────────────────

interface LiveChord {
  oscillators: OscillatorNode[];
  master: GainNode;
  startedAtMs: number;
  sustainMs: number;
}

let live: LiveChord | null = null;

/** Build one voice's node graph; returns the oscillators to start/stop. */
function buildVoice(
  ac: BaseAudioContext, v: VoiceSpec, s: PlaygroundSettings, out: AudioNode,
): OscillatorNode[] {
  const voiceGain = ac.createGain();
  voiceGain.gain.value = v.gain;
  voiceGain.connect(out);

  if (s.operator === 'add') {
    if (s.ratioMode === 'resonance') {
      // Integer harmonics k (partial 1) and m·? — partial 1 = harmonic
      // `outer` of fundamental f/outer… use k=inner, m=outer: partial1 at
      // freq = harmonic `outerOrbits`? Ratio = inner/outer, so with
      // fundamental f/outer: partial1 = harmonic outer, partial2 = harmonic
      // inner. Encoded via v.ratio = inner/outer (rational by construction).
      // Recover small integers from the ratio: denominator = outerOrbits.
      // We re-derive them: ratio = p/q in lowest terms with q ≤ 20 (search).
      let p = 0, q = 1;
      for (let den = 1; den <= 64; den++) {
        const num = Math.round(v.ratio * den);
        if (Math.abs(v.ratio - num / den) < 1e-9) { p = num; q = den; break; }
      }
      if (p > 0) {
        const len = Math.max(p, q) + 1;
        const real = new Float32Array(len);
        const imag = new Float32Array(len);
        const phi = (s.phaseDeg * Math.PI) / 180;
        // x(t) = Σ real[n]·cos(nωt) + imag[n]·sin(nωt);
        // partial 1: sin(qωt) → imag[q]; partial 2: sin(pωt + φ).
        imag[q] = 1 - s.balance;
        real[p] += s.balance * Math.sin(phi);
        imag[p] += s.balance * Math.cos(phi);
        const osc = ac.createOscillator();
        osc.setPeriodicWave(ac.createPeriodicWave(real, imag,
          { disableNormalization: false }));
        osc.frequency.value = v.freq / q;
        osc.connect(voiceGain);
        return [osc];
      }
    }
    // Free ratio (or integer recovery failed): two summed sines, no phase.
    const o1 = ac.createOscillator();
    o1.frequency.value = v.freq;
    const g1 = ac.createGain(); g1.gain.value = 1 - s.balance;
    o1.connect(g1); g1.connect(voiceGain);
    const o2 = ac.createOscillator();
    o2.frequency.value = v.freq * v.ratio;
    const g2 = ac.createGain(); g2.gain.value = s.balance;
    o2.connect(g2); g2.connect(voiceGain);
    return [o1, o2];
  }

  if (s.operator === 'ring') {
    const carrier = ac.createOscillator();
    carrier.frequency.value = v.freq;
    const ring = ac.createGain();
    ring.gain.value = 0; // fully modulated product
    const modulator = ac.createOscillator();
    modulator.frequency.value = v.freq * v.ratio;
    carrier.connect(ring);
    modulator.connect(ring.gain);
    ring.connect(voiceGain);
    return [carrier, modulator];
  }

  // fm
  const carrier = ac.createOscillator();
  carrier.frequency.value = v.freq;
  const modulator = ac.createOscillator();
  modulator.frequency.value = v.freq * v.ratio;
  const modDepth = ac.createGain();
  modDepth.gain.value = s.fmIndex * v.freq * v.ratio; // deviation = I·f_mod
  modulator.connect(modDepth);
  modDepth.connect(carrier.frequency);
  carrier.connect(voiceGain);
  return [carrier, modulator];
}

/** Play (retrigger) the Nodal Chord. No-op before audio init (bus is null). */
export function playNodalChord(
  points: NodalPoint[],
  s: PlaygroundSettings,
  resonance: PairResonanceLike,
  maxRadius: number,
): void {
  stopNodalChord(0.05);
  const bus = getChordBus();
  if (bus === null || points.length === 0) return;
  const ac = bus.context;
  const t0 = ac.currentTime;

  const master = ac.createGain();
  master.gain.value = 0;
  master.connect(bus);

  // Breathe: LFO wobbles a post-envelope gain around 1 by ±BREATHE_DEPTH.
  const breathe = ac.createGain();
  breathe.gain.value = 1;
  const lfo = ac.createOscillator();
  lfo.frequency.value = BREATHE_HZ;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = BREATHE_DEPTH;
  lfo.connect(lfoDepth);
  lfoDepth.connect(breathe.gain);
  breathe.connect(master);

  const perVoice = 1 / Math.sqrt(points.length); // keep chords of any size level
  const voiceBus = ac.createGain();
  voiceBus.gain.value = perVoice;
  voiceBus.connect(breathe);

  const oscillators: OscillatorNode[] = [lfo];
  for (const v of chordVoices(points, s, resonance, maxRadius)) {
    oscillators.push(...buildVoice(ac, v, s, voiceBus));
  }

  // Organ envelope: attack → sustain (breathing) → release.
  const sustainS = s.sustainMs / 1000;
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(s.gain, t0 + CHORD_ATTACK_S);
  master.gain.setValueAtTime(s.gain, t0 + CHORD_ATTACK_S + sustainS);
  master.gain.linearRampToValueAtTime(0, t0 + CHORD_ATTACK_S + sustainS + CHORD_RELEASE_S);

  const stopAt = t0 + CHORD_ATTACK_S + sustainS + CHORD_RELEASE_S + 0.1;
  for (const o of oscillators) { o.start(t0); o.stop(stopAt); }

  live = { oscillators, master, startedAtMs: performance.now(), sustainMs: s.sustainMs };
}

/** Fade out and drop the live chord (pair change / selector close). */
export function stopNodalChord(fadeS = 0.15): void {
  if (live === null) return;
  const { oscillators, master } = live;
  live = null;
  try {
    const t = master.context.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + fadeS);
    for (const o of oscillators) o.stop(t + fadeS + 0.05);
  } catch {
    for (const o of oscillators) { try { o.stop(); } catch { /* already stopped */ } }
  }
}

/**
 * Visual breathe level 0..1, mirroring the audio envelope+LFO from wall time
 * (deterministic math, no AudioParam reads — eye and ear follow one curve).
 */
export function chordGlow(nowMs: number = performance.now()): number {
  if (live === null) return 0;
  const el = (nowMs - live.startedAtMs) / 1000;
  const sustainS = live.sustainMs / 1000;
  let env: number;
  if (el < CHORD_ATTACK_S) env = el / CHORD_ATTACK_S;
  else if (el < CHORD_ATTACK_S + sustainS) env = 1;
  else if (el < CHORD_ATTACK_S + sustainS + CHORD_RELEASE_S) {
    env = 1 - (el - CHORD_ATTACK_S - sustainS) / CHORD_RELEASE_S;
  } else return 0;
  const breathe = 1 + BREATHE_DEPTH * Math.sin(2 * Math.PI * BREATHE_HZ * el);
  return Math.min(Math.max(env * breathe, 0), 1);
}
```

- [ ] **Step 5: Run tests** → `npx vitest run src/__tests__/nodal-chord.test.ts` → PASS. Also `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/audio.ts src/nodal-chord.ts src/__tests__/nodal-chord.test.ts
git commit -m "feat: Nodal Chord raw-WebAudio synth + chord bus (ADR 0003)"
```

---

### Task 5: `src/pattern-preview.ts` — draw-once + nodal glow overlay

**Files:**
- Modify: `src/pattern-preview.ts` (full rewrite of the loop body)
- Modify: `src/__tests__/pattern-preview.test.ts` (replace loop-fraction tests)
- Modify: `src/controls.ts:423-424` (createPreviewLoop call gains a hooks argument — done fully in Task 7; here pass a stub so it compiles)

- [ ] **Step 1: Replace the preview tests**

```ts
// src/__tests__/pattern-preview.test.ts  (replace file contents)
// Preview is draw-once (CONTEXT.md 2026-07-06): the figure draws over
// PREVIEW_DRAW_MS then holds completed; no loop.
import { describe, it, expect } from 'vitest';
import { PREVIEW_DRAW_MS, previewLineFraction } from '../pattern-preview';

describe('previewLineFraction (draw-once)', () => {
  it('starts at 0 and completes at PREVIEW_DRAW_MS', () => {
    expect(previewLineFraction(0)).toBe(0);
    expect(previewLineFraction(PREVIEW_DRAW_MS)).toBe(1);
  });
  it('holds at 1 forever after (no loop)', () => {
    expect(previewLineFraction(PREVIEW_DRAW_MS * 2)).toBe(1);
    expect(previewLineFraction(PREVIEW_DRAW_MS * 100)).toBe(1);
  });
  it('is monotonic during the draw', () => {
    expect(previewLineFraction(PREVIEW_DRAW_MS * 0.25))
      .toBeLessThan(previewLineFraction(PREVIEW_DRAW_MS * 0.5));
  });
  it('clamps negative elapsed to 0', () => {
    expect(previewLineFraction(-50)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (PREVIEW_DRAW_MS not exported).

- [ ] **Step 3: Rewrite the module**

```ts
// src/pattern-preview.ts
//
// The selector's Preview pane (CONTEXT.md: fast, disposable, draw-ONCE — the
// figure draws over PREVIEW_DRAW_MS then holds completed; never touches the
// field or the user's probes). When the draw completes, hooks.onDrawComplete
// fires once (the Nodal Chord trigger) and the hook-supplied Nodal Points are
// overlaid, breathing with hooks.getGlow() (0..1, mirrors the chord envelope).

import { computePatternLines, type PlanetaryPattern } from './patterns';
import type { LinkLine } from './engine';

/** Draw duration — matches the old loop's 75%-of-3000ms draw phase. */
export const PREVIEW_DRAW_MS = 2250;
/** Line density for planet-pair previews (denser than 120px thumbnails). */
export const PREVIEW_SAMPLES = 400;
/** Nodal Point glow colour (sweeper violet — the probe-family accent). */
export const NODAL_GLOW_COLOR = '#C084FC';

/** Map elapsed ms since (re)start to the fraction of lines drawn. */
export function previewLineFraction(elapsedMs: number): number {
  return Math.min(Math.max(elapsedMs / PREVIEW_DRAW_MS, 0), 1);
}

export interface PreviewHooks {
  /** Nodal Points (canvas coords) to breathe once the draw completes. */
  getNodalPoints(): { x: number; y: number }[];
  /** 0..1 breathe level (chordGlow); 0 hides the overlay's pulse. */
  getGlow(): number;
  /** Fires exactly once per (re)draw when the figure completes. */
  onDrawComplete(): void;
}

export interface PreviewLoop {
  /** Swap the previewed pattern and restart the draw (starts rAF if stopped). */
  setPattern(p: PlanetaryPattern): void;
  /** Restart the draw for the current pattern (click-to-replay). */
  replay(): void;
  /** Cancel the rAF loop (call whenever the selector closes). */
  stop(): void;
}

export function createPreviewLoop(
  canvas: HTMLCanvasElement,
  getLineColor: () => string,
  hooks: PreviewHooks,
): PreviewLoop {
  const g = canvas.getContext('2d')!;
  let lines: LinkLine[] = [];
  let raf = 0;
  let startTime = 0;
  let completed = false;

  function frame(now: number): void {
    if (startTime === 0) startTime = now;
    const frac = previewLineFraction(now - startTime);
    const count = Math.floor(frac * lines.length);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = getLineColor();
    g.lineWidth = 0.6;
    for (let i = 0; i < count; i++) {
      const l = lines[i];
      g.beginPath();
      g.moveTo(l.p1.x, l.p1.y);
      g.lineTo(l.p2.x, l.p2.y);
      g.stroke();
    }
    if (frac >= 1 && !completed) {
      completed = true;
      hooks.onDrawComplete();
    }
    if (completed) {
      const glow = hooks.getGlow();
      const pts = hooks.getNodalPoints();
      for (const p of pts) {
        g.beginPath();
        g.arc(p.x, p.y, 3 + 4 * glow, 0, Math.PI * 2);
        g.fillStyle = NODAL_GLOW_COLOR;
        g.globalAlpha = 0.25 + 0.75 * glow;
        g.fill();
        g.globalAlpha = 1;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function restart(): void {
    startTime = 0;
    completed = false;
    if (raf === 0) raf = requestAnimationFrame(frame);
  }

  return {
    setPattern(p: PlanetaryPattern): void {
      lines = computePatternLines(p, canvas.width, PREVIEW_SAMPLES);
      restart();
    },
    replay(): void {
      restart();
    },
    stop(): void {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      startTime = 0;
      completed = false;
    },
  };
}
```

- [ ] **Step 4: Patch the call site so the build stays green**

In `src/controls.ts` line 423-425, temporarily pass no-op hooks (Task 7 replaces them):

```ts
  if (previewLoop === null) {
    previewLoop = createPreviewLoop(dom.patternPreviewCanvas, () => thumbLineColor(state), {
      getNodalPoints: () => [],
      getGlow: () => 0,
      onDrawComplete: () => {},
    });
  }
```

- [ ] **Step 5: Run** `npx vitest run src/__tests__/pattern-preview.test.ts` and `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pattern-preview.ts src/__tests__/pattern-preview.test.ts src/controls.ts
git commit -m "feat: Preview draws once and holds; nodal glow overlay hooks"
```

---

### Task 6: playground drawer markup + styles + DOM registry

**Files:**
- Modify: `index.html` (insert drawer after the three-pane row, before the special row — between lines 68 and 70, i.e. after the closing `</div>` of the pane row and before `<div id="pattern-cards" …>`'s wrapper)
- Modify: `src/dom.ts` (register new elements)
- Modify: `src/style.css` (drawer styles; append at end)

- [ ] **Step 1: Add the drawer markup to index.html**

Locate the selector structure (line 47-75). Insert directly after the element that closes the three-pane row (the parent of `.pattern-preview-pane`) and before the special-row wrapper containing `#pattern-cards`:

```html
        <!-- Timbre playground (hidden surprise): unlocked by double-clicking
             the preview or ?playground. One global settings object for all
             pairs. See ADR 0003 + CONTEXT.md (Nodal Chord). -->
        <div id="playground-drawer" class="playground-drawer hidden">
          <div class="playground-row">
            <label>Operator
              <select id="pg-operator">
                <option value="add">Add</option>
                <option value="ring">Ring</option>
                <option value="fm">FM</option>
              </select>
            </label>
            <label>Balance
              <input id="pg-balance" type="range" min="0" max="1" step="0.01">
            </label>
            <label>Phase
              <input id="pg-phase" type="range" min="0" max="360" step="1">
            </label>
            <label>FM index
              <input id="pg-fm-index" type="range" min="0" max="10" step="0.1">
            </label>
          </div>
          <div class="playground-row">
            <label>Ratio
              <select id="pg-ratio-mode">
                <option value="resonance">m:k resonance</option>
                <option value="free">Free</option>
              </select>
            </label>
            <label>Free ratio
              <input id="pg-free-ratio" type="range" min="0.25" max="4" step="0.01">
            </label>
            <label>Root f₀
              <input id="pg-f0" type="range" min="65.4" max="1046.5" step="0.1">
            </label>
            <label class="pg-check">Wrap octave
              <input id="pg-wrap" type="checkbox">
            </label>
          </div>
          <div class="playground-row">
            <label>Radius →
              <select id="pg-radius-mapping">
                <option value="none">None</option>
                <option value="gain">Gain</option>
                <option value="octave">Octave</option>
              </select>
            </label>
            <label>Sustain
              <input id="pg-sustain" type="range" min="500" max="8000" step="100">
            </label>
            <label>Gain
              <input id="pg-gain" type="range" min="0" max="1" step="0.01">
            </label>
            <button id="pg-copy-code" type="button" class="pg-copy-btn"
              title="Serialize current knobs as the DEFAULT_SETTINGS literal">
              Copy settings as code
            </button>
          </div>
        </div>
```

- [ ] **Step 2: Register elements in src/dom.ts**

Follow the existing pattern in `resolveDomElements()` (line 85): add to the `DomElements` interface and the resolver:

```ts
  // Timbre playground drawer (pattern selector)
  playgroundDrawer: HTMLElement;
  pgOperator: HTMLSelectElement;
  pgBalance: HTMLInputElement;
  pgPhase: HTMLInputElement;
  pgFmIndex: HTMLInputElement;
  pgRatioMode: HTMLSelectElement;
  pgFreeRatio: HTMLInputElement;
  pgF0: HTMLInputElement;
  pgWrap: HTMLInputElement;
  pgRadiusMapping: HTMLSelectElement;
  pgSustain: HTMLInputElement;
  pgGain: HTMLInputElement;
  pgCopyCode: HTMLButtonElement;
```

with resolver lines matching the file's existing `document.getElementById('…') as …` idiom:

```ts
    playgroundDrawer: document.getElementById('playground-drawer') as HTMLElement,
    pgOperator: document.getElementById('pg-operator') as HTMLSelectElement,
    pgBalance: document.getElementById('pg-balance') as HTMLInputElement,
    pgPhase: document.getElementById('pg-phase') as HTMLInputElement,
    pgFmIndex: document.getElementById('pg-fm-index') as HTMLInputElement,
    pgRatioMode: document.getElementById('pg-ratio-mode') as HTMLSelectElement,
    pgFreeRatio: document.getElementById('pg-free-ratio') as HTMLInputElement,
    pgF0: document.getElementById('pg-f0') as HTMLInputElement,
    pgWrap: document.getElementById('pg-wrap') as HTMLInputElement,
    pgRadiusMapping: document.getElementById('pg-radius-mapping') as HTMLSelectElement,
    pgSustain: document.getElementById('pg-sustain') as HTMLInputElement,
    pgGain: document.getElementById('pg-gain') as HTMLInputElement,
    pgCopyCode: document.getElementById('pg-copy-code') as HTMLButtonElement,
```

(If `resolveDomElements` uses a helper like `byId(...)`, follow that idiom instead — match the file.)

- [ ] **Step 3: Add styles to src/style.css (append; reuse the selector's existing CSS variables/colours — inspect the `.pattern-preview-pane` block and match its border/background tokens)**

```css
/* ── Timbre playground drawer (hidden surprise) ─────────────────────────── */
.playground-drawer {
  margin-top: 10px;
  padding: 10px 12px;
  border-top: 1px solid rgba(194, 118, 46, 0.25);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}
.playground-drawer.hidden { display: none; }
.playground-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.playground-row label {
  display: flex;
  align-items: center;
  gap: 5px;
  opacity: 0.85;
  white-space: nowrap;
}
.playground-row input[type="range"] { width: 90px; }
.pg-copy-btn {
  margin-left: auto;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
}
```

- [ ] **Step 4: Verify** `npx tsc --noEmit` passes and `npm test` still green (dom resolution is exercised by jsdom-less suites only if dom.ts is imported — if `controls.test.ts` fails on missing elements, add the same markup to its test fixture HTML, following how the existing selector elements are stubbed there).

- [ ] **Step 5: Commit**

```bash
git add index.html src/dom.ts src/style.css src/__tests__/controls.test.ts
git commit -m "feat: playground drawer markup, styles, DOM registry"
```

---### Task 7: controls.ts wiring — gate, chord trigger, replay, unlock, knobs

**Files:**
- Modify: `src/controls.ts` (selector section, lines 386-540, plus `setupEventHandlers`)

- [ ] **Step 1: Imports and module state**

Add imports at the top of `controls.ts` (near the existing pattern imports):

```ts
import { findNodalPoints, type NodalPoint } from './nodal-points';
import { playNodalChord, stopNodalChord, chordGlow } from './nodal-chord';
import {
  loadSettings, saveSettings, loadUnlocked, saveUnlocked,
  settingsAsCode, NODAL_CHORD_DEFAULT_ON, type PlaygroundSettings,
} from './playground-settings';
import { computeResonance } from './pattern-generator';
```

(`computeResonance` and `getPatternForPair` are already exported from pattern-generator; `getPatternForPair` is already imported — extend that import instead of duplicating.)

Add module state next to `pickerInner`/`pickerOuter` (line 396):

```ts
// ── Timbre playground state (one global settings object; ADR 0003) ─────────
let playgroundSettings: PlaygroundSettings = loadSettings(localStorage);
let playgroundUnlocked =
  loadUnlocked(localStorage) ||
  new URLSearchParams(window.location.search).has('playground');
let previewNodalPoints: NodalPoint[] = [];
let previewResonance = { innerOrbits: 13, outerOrbits: 8 };

function chordEnabled(): boolean {
  return NODAL_CHORD_DEFAULT_ON || playgroundUnlocked;
}
```

- [ ] **Step 2: Real preview hooks + chord trigger**

Replace the Task-5 stub hooks in `showPatternSelector`:

```ts
  if (previewLoop === null) {
    previewLoop = createPreviewLoop(dom.patternPreviewCanvas, () => thumbLineColor(state), {
      getNodalPoints: () => chordEnabled() ? previewNodalPoints : [],
      getGlow: () => chordGlow(),
      onDrawComplete: () => triggerPreviewChord(dom),
    });
  }
```

and add below `updatePreviewPane`:

```ts
const PREVIEW_CANVAS_SIZE = 280; // matches index.html width/height
/** Detection sampling density — finer than the drawn 400 for stable maxima. */
const NODAL_DETECT_SAMPLES = 1200;

function triggerPreviewChord(dom: DomElements): void {
  if (!chordEnabled() || previewNodalPoints.length === 0) return;
  playNodalChord(
    previewNodalPoints, playgroundSettings, previewResonance,
    PREVIEW_CANVAS_SIZE / 2,
  );
  void dom; // (dom reserved for a future level meter)
}
```

- [ ] **Step 3: Compute nodal points on pair change**

In `updatePreviewPane` (line 494), after `previewLoop?.setPattern(pattern);` add:

```ts
  stopNodalChord(0.1); // pair changed mid-chord — fade the old pair out
  previewNodalPoints = [];
  if (chordEnabled() && (pattern.kind ?? 'planet') === 'planet'
      && !pattern.geocentric && pattern.period1 && pattern.period2) {
    // Nodal Chord is planet-pair only: specials (cardioid, moon-hexagon)
    // have no consecutive-link-line envelope in the nodality.js sense.
    previewResonance = computeResonance(pattern.period1, pattern.period2);
    previewNodalPoints = findNodalPoints(
      computePatternLines(pattern, PREVIEW_CANVAS_SIZE, NODAL_DETECT_SAMPLES),
      PREVIEW_CANVAS_SIZE / 2, PREVIEW_CANVAS_SIZE / 2,
      pattern.petals, PREVIEW_CANVAS_SIZE,
    );
  }
```

(`computePatternLines` is already imported in controls.ts via patterns import — extend the import if not.)

- [ ] **Step 4: Click = replay, double-click = unlock + open drawer**

In `setupEventHandlers`, with the other listener registrations:

```ts
  // Preview interactions: click replays the draw+chord; double-click is the
  // hidden surprise — it unlocks and opens the timbre playground drawer.
  dom.patternPreviewCanvas.addEventListener('click', () => {
    previewLoop?.replay();
  });
  dom.patternPreviewCanvas.addEventListener('dblclick', () => {
    if (!playgroundUnlocked) {
      playgroundUnlocked = true;
      saveUnlocked(localStorage, true);
      updatePreviewPane(state, dom); // compute points now that we're unlocked
    }
    syncPlaygroundInputs(dom);
    dom.playgroundDrawer.classList.toggle('hidden');
  });
```

- [ ] **Step 5: Show drawer state on selector open + stop chord on close**

In `showPatternSelector`, before the final `classList.remove('hidden')`:

```ts
  // Drawer visible only when already unlocked (never auto-opens).
  dom.playgroundDrawer.classList.add('hidden');
```

In `hidePatternSelector` (line 537):

```ts
function hidePatternSelector(dom: DomElements): void {
  previewLoop?.stop();
  stopNodalChord();
  dom.playgroundDrawer.classList.add('hidden');
  dom.patternSelectorEl.classList.add('hidden');
}
```

- [ ] **Step 6: Knob wiring — every change saves + retriggers**

Add to `setupEventHandlers`:

```ts
  // ── Playground knobs: mutate the one global settings object, persist,
  //    and retrigger the chord so every change is heard immediately. ──────
  function syncPlaygroundInputs(d: DomElements): void {
    d.pgOperator.value = playgroundSettings.operator;
    d.pgBalance.value = String(playgroundSettings.balance);
    d.pgPhase.value = String(playgroundSettings.phaseDeg);
    d.pgFmIndex.value = String(playgroundSettings.fmIndex);
    d.pgRatioMode.value = playgroundSettings.ratioMode;
    d.pgFreeRatio.value = String(playgroundSettings.freeRatio);
    d.pgF0.value = String(playgroundSettings.f0);
    d.pgWrap.checked = playgroundSettings.wrapOctave;
    d.pgRadiusMapping.value = playgroundSettings.radiusMapping;
    d.pgSustain.value = String(playgroundSettings.sustainMs);
    d.pgGain.value = String(playgroundSettings.gain);
  }

  function onKnobChange(mutate: (s: PlaygroundSettings) => void): void {
    mutate(playgroundSettings);
    saveSettings(localStorage, playgroundSettings);
    triggerPreviewChord(dom);
  }

  dom.pgOperator.addEventListener('change', () =>
    onKnobChange(s => { s.operator = dom.pgOperator.value as PlaygroundSettings['operator']; }));
  dom.pgBalance.addEventListener('input', () =>
    onKnobChange(s => { s.balance = Number(dom.pgBalance.value); }));
  dom.pgPhase.addEventListener('input', () =>
    onKnobChange(s => { s.phaseDeg = Number(dom.pgPhase.value); }));
  dom.pgFmIndex.addEventListener('input', () =>
    onKnobChange(s => { s.fmIndex = Number(dom.pgFmIndex.value); }));
  dom.pgRatioMode.addEventListener('change', () =>
    onKnobChange(s => { s.ratioMode = dom.pgRatioMode.value as PlaygroundSettings['ratioMode']; }));
  dom.pgFreeRatio.addEventListener('input', () =>
    onKnobChange(s => { s.freeRatio = Number(dom.pgFreeRatio.value); }));
  dom.pgF0.addEventListener('input', () =>
    onKnobChange(s => { s.f0 = Number(dom.pgF0.value); }));
  dom.pgWrap.addEventListener('change', () =>
    onKnobChange(s => { s.wrapOctave = dom.pgWrap.checked; }));
  dom.pgRadiusMapping.addEventListener('change', () =>
    onKnobChange(s => { s.radiusMapping = dom.pgRadiusMapping.value as PlaygroundSettings['radiusMapping']; }));
  dom.pgSustain.addEventListener('input', () =>
    onKnobChange(s => { s.sustainMs = Number(dom.pgSustain.value); }));
  dom.pgGain.addEventListener('input', () =>
    onKnobChange(s => { s.gain = Number(dom.pgGain.value); }));

  dom.pgCopyCode.addEventListener('click', () => {
    void navigator.clipboard.writeText(settingsAsCode(playgroundSettings));
    dom.pgCopyCode.textContent = 'Copied!';
    setTimeout(() => { dom.pgCopyCode.textContent = 'Copy settings as code'; }, 1200);
  });
```

Note: `syncPlaygroundInputs` is referenced from the dblclick handler in Step 4 — define it above that handler (or hoist as a function declaration, which the code above is).

**Rate-limit check:** `input` events fire per pixel of slider drag; `playNodalChord` restarts the full graph each call. If dragging audibly stutters in Task 9's E2E pass, debounce `triggerPreviewChord` in `onKnobChange` with a 120ms trailing timer — decide from the E2E evidence, not preemptively.

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit && npm test` → all green (fix `controls.test.ts` fixture if it stubs selector DOM — add the new pg-* elements to its fixture the same way `#pattern-preview-canvas` is stubbed there).

```bash
git add src/controls.ts src/__tests__/controls.test.ts
git commit -m "feat: wire Nodal Chord + playground into the pattern selector"
```

---

### Task 8: Sweeper Hold (`H`) — freeze arm, sustain the current tick

**Files:**
- Modify: `src/shapes.ts` (add `held` field ~line 217 area; add `currentTick()` + `toHeldStrudelCode()` after `_toSweeperCode`, ~line 1018)
- Modify: `src/main.ts:139-161` (skip phase advance while held)
- Modify: `src/controls.ts` (H hotkey + `toggleHold`)
- Modify: `src/keyboard-shortcuts.ts` (panel row — match the file's existing row format)
- Test: `src/__tests__/shapes.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to shapes.test.ts)**

```ts
describe('sweeper Hold (toHeldStrudelCode)', () => {
  function heldSweeper(): CanvasShape {
    const s = new CanvasShape(0, 0, 'sweeper');
    // Inject a minimal baked tick table: 60 ticks × 1 arm × up to k slots.
    const empty = Array.from({ length: 60 }, () => [] as unknown[]);
    empty[0] = [
      { x: 10, y: 0, freq: 220, gain: 0.5 },
      { x: 20, y: 0, freq: 330, gain: 0.25 },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.sweepTicks = [empty as any];
    s.playheadAngle = s.startAngle; // playhead sits in tick 0
    return s;
  }

  it('emits one sustained voice per slot of the current tick', () => {
    const code = heldSweeper().toHeldStrudelCode();
    expect(code).toContain('freq(220.0)');
    expect(code).toContain('freq(330.0)');
    expect(code).toContain('.sustain(1)');
    expect(code).toContain('HELD');
  });
  it('keeps the shape block markers so replaceShapeBlock can swap it back', () => {
    const s = heldSweeper();
    const code = s.toHeldStrudelCode();
    expect(code).toContain(`// @shape-start-${s.id}`);
    expect(code).toContain(`// @shape-end-${s.id}`);
    expect(code).toContain(`.p((${s.id}).toString())`);
  });
  it('emits a silent fallback when the current tick has no clusters', () => {
    const s = heldSweeper();
    s.playheadAngle = s.startAngle + Math.PI; // opposite side: empty tick
    expect(s.toHeldStrudelCode()).toContain('gain(0)');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → `toHeldStrudelCode` not a function.

- [ ] **Step 3: Implement in shapes.ts**

Add the field near the other sweeper runtime fields (find `sweepAudioRefTime` declaration and add beside it):

```ts
  /** Held (CONTEXT.md): arm frozen, current tick's voices sustained. */
  held = false;
```

Add methods after `_toSweeperCode()` (line 1018), inside the class:

```ts
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
   * probe keeps its Generator + committed effect chain sound (ADR 0003's
   * boundary: probe audio never leaves Strudel). Swapped in/out of the live
   * code via replaceShapeBlock; the original block is restored verbatim.
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
```

- [ ] **Step 4: Freeze the arm in main.ts**

Wrap the phase-advance in the animate loop (line 139-161) so held sweepers skip it — the whole `try/catch` becomes:

```ts
      try {
        if (shape.held) {
          // Held (CONTEXT.md): arm frozen; Strudel plays the swapped-in
          // sustained block. prevPlayheadAngle keeps pace so unhold is clean.
          shape.prevPlayheadAngle = shape.playheadAngle;
        } else if (state.audioInitialized && shape.sweepAudioRefTime > 0) {
          const cycleS  = 60 / state.cpm;
          const elapsed = getAudioContext().currentTime - shape.sweepAudioRefTime;
          let phase: number;
          if (shape.playbackMode === 'ping-pong') {
            // Triangle wave over a 2-cycle period: phase goes 0→1→0 so the arm
            // sweeps forward in cycle 1 and reverse in cycle 2 — locked to the
            // same audio clock Strudel's `.palindrome()` rides on.
            const tp = (elapsed / (cycleS * 2)) % 1;
            phase    = tp < 0.5 ? tp * 2 : 2 - tp * 2;
          } else {
            phase = (shape.sweepPhaseAtRef + elapsed / cycleS) % 1;
          }
          shape.prevPlayheadAngle = shape.playheadAngle;
          shape.playheadAngle     = (shape.startAngle + phase * Math.PI * 2) % (Math.PI * 2);
        } else {
          shape.stepPlayhead(dt, state.cpm);
        }
      } catch (e) {
        console.debug('[audio] AC clock fallback:', e);
        if (!shape.held) shape.stepPlayhead(dt, state.cpm);
      }
```

- [ ] **Step 5: toggleHold + H hotkey in controls.ts**

Add near `evaluateAndFlash` (line 622):

```ts
// ── Sweeper Hold (CONTEXT.md: Held) ─────────────────────────────────────────
// Toggle per probe: freeze the arm and sustain the current tick's voices.
// The original Strudel block (which may be a node-editor commit we cannot
// regenerate) is saved verbatim and restored on unhold.
const heldBlocks = new Map<number, string>();

function toggleHold(state: AppState, dom: DomElements): void {
  const s = state.activeShape;
  if (s === null || s.type !== 'sweeper' || !state.audioInitialized) return;
  if (!s.held) {
    const regex = new RegExp(`// @shape-start-${s.id}[\\s\\S]*?// @shape-end-${s.id}`);
    const m = regex.exec(dom.telemetryTextarea.value);
    if (m === null) return; // no live block — nothing to hold
    heldBlocks.set(s.id, m[0]);
    replaceShapeBlock(dom.telemetryTextarea, s.id, s.toHeldStrudelCode());
    s.held = true;
  } else {
    const saved = heldBlocks.get(s.id);
    if (saved !== undefined) replaceShapeBlock(dom.telemetryTextarea, s.id, saved);
    heldBlocks.delete(s.id);
    s.held = false;
    // Re-anchor the audio clock so the arm resumes from its frozen angle.
    const acTime = getAudioTime();
    if (acTime > 0) {
      s.sweepAudioRefTime = acTime;
      const twoPi = Math.PI * 2;
      s.sweepPhaseAtRef =
        (((s.playheadAngle - s.startAngle) % twoPi) + twoPi) % twoPi / twoPi;
    }
  }
  if (state.isPlaying) evaluateAndFlash(state, dom);
}
```

(`replaceShapeBlock` is exported from telemetry.ts — extend the existing telemetry import; `getAudioTime` is already imported.)

Add the hotkey in the keydown switch (after `case 'e'`, line 1185):

```ts
      case 'h':
        // H: Hold the active sweeper — freeze the arm, sustain the tick.
        toggleHold(state, dom);
        break;
```

Also: shape deletion must clear stale state — in `deleteActiveShape` (find it in controls.ts), add `heldBlocks.delete(shape.id)` beside the existing cleanup (deletion regenerates the full code, so only the map entry needs clearing).

- [ ] **Step 6: Keyboard-shortcuts panel row**

Open `src/keyboard-shortcuts.ts`, find the rows array/markup listing entries like `P — pattern selector`, and append an entry following the file's exact format: key `H`, description "Hold sweeper (freeze arm, sustain chord)".

- [ ] **Step 7: Run all tests + commit**

Run: `npx tsc --noEmit && npm test` → green.

```bash
git add src/shapes.ts src/main.ts src/controls.ts src/keyboard-shortcuts.ts src/__tests__/shapes.test.ts
git commit -m "feat: sweeper Hold — H freezes the arm and sustains the current tick"
```

---

### Task 9: E2E verification (dev server + preview tools)

Per CLAUDE.md: test the features yourself before claiming done. Server: `preview_start` with launch config `solar-system-dev` (port 5180).

- [ ] **Step 1: Baseline** — start server, open app with `?playground`, click "Start with sound", confirm no console errors and (critically) **no sound before Play** — the chord must not fire until the selector preview completes a draw.
- [ ] **Step 2: Nodal Chord** — press `P`; Venus-Earth preview draws once and holds; after ~2.25s the 5 nodal points appear and breathe (screenshot); verify via `preview_eval` that an AudioContext is running and `chordGlow()`-driven overlay renders (inspect canvas pixels or expose a debug counter). Switch to Earth-Mars: old chord fades, new draw, 7 points. Click preview → replay. Double-click → drawer opens.
- [ ] **Step 3: Knobs** — move operator to `fm`, drag FM index: chord retriggers on each change (console-count `playNodalChord` calls via a temporary `console.debug` or `preview_eval` hook); "Copy settings as code" puts a `DEFAULT_SETTINGS` literal on the clipboard (assert button text flips to "Copied!").
- [ ] **Step 4: Gate** — in a fresh profile (clear localStorage, no `?playground`): preview draws once, **no** nodal overlay, **no** chord (NODAL_CHORD_DEFAULT_ON is false). Double-click preview → surprise unlocks.
- [ ] **Step 5: Hold** — close selector, press Play, spawn a sweeper (`N`), press `H`: arm freezes, sound becomes a steady chord (verify the telemetry textarea now contains `HELD at tick`); press `H` again: original block restored byte-identical (capture before/after via `preview_eval` on the textarea value), arm resumes from the frozen angle without jumping. Verify a second sweeper keeps rotating while the first is held.
- [ ] **Step 6: Esc/close paths** — close the selector mid-chord: sound fades, no stuck oscillators (check `preview_console_logs` for errors).
- [ ] **Step 7:** Fix anything found (source edits, re-run affected unit tests), then commit fixes.

---

### Task 10: Docs + final commit

- [ ] **Step 1:** Progress.md — new dated entry: nodal chord + playground + hold; any bugs found in Task 9 documented with root cause (house style: LESSON lines).
- [ ] **Step 2:** CLAUDE.md — update test counts in the Commands section (29 suites will have grown to 32; update pass counts from the final `npm test` output). Add `H` to any hotkey documentation if present.
- [ ] **Step 3:** Run `npm test` one final time; record counts.
- [ ] **Step 4:**

```bash
git add Progress.md CLAUDE.md
git commit -m "docs: Progress entry + test counts for nodal chord/playground/hold"
```

---

## Self-review checklist (done at planning time)

- **Spec coverage:** item 1 → Task 8; item 2 → Tasks 3/4/6/7 (knob space); item 3 → Tasks 1/2/4 (continuous fifths, angle from polar coords); item 4 → Tasks 2/4/5/7 (petals-sized chord, breathe, organ envelope); item 5 → Tasks 3/6/7 (gate constant, two doors, global settings, copy-as-code).
- **Types consistent:** `NodalPoint {x,y,angleDeg,radius,nodality}` (Tasks 2→4→7); `PlaygroundSettings` field names identical across Tasks 3/4/7; `PreviewHooks` (Tasks 5→7); `toHeldStrudelCode` (Tasks 8 test→impl→controls).
- **Known risks:** (1) Venus-Earth empirical detection — contingency written into Task 2 Step 4. (2) `controls.test.ts` DOM fixtures may need the new pg-* elements — called out in Tasks 6/7. (3) knob-drag retrigger churn — decision deferred to E2E evidence (Task 7 Step 6 note). (4) `dom.ts` idiom may differ from the literal snippet — instruction says match the file.
