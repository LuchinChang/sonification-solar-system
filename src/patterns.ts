// src/patterns.ts
//
// Planetary link-line pattern definitions and helpers.
// Each pattern describes two planets whose orbital link lines
// trace a spirograph-like curve over a full resonance cycle.

import { calculateGeocentricLines, calculateEllipticalLines, calculateCardioidLines, calculateMoonHexagonLines, type LinkLine } from './engine';

// ─── Types ────────────────────────────────────────────────────

export interface PatternCaption {
  atProgress: number;   // 0..1 — when to start showing
  text: string;         // karaoke line
  duration: number;     // seconds to hold on screen
}

/** Per-pattern config for the cardioid (multiplication-table-on-a-circle) generator.
 *  N (number of rim points) is taken from `state.sampleRate` at render time —
 *  the existing sample-rate knob doubles as the cardioid's point count. */
export interface CardioidConfig {
  multiplier: number; // n in the rule: chord connects i → (i·n) mod N
  radius: number;     // chord-circle radius in canvas px
}

export type PatternKind = 'planet' | 'cardioid' | 'moon-hexagon';

export interface PlanetaryPattern {
  id: string;
  name: string;
  /** 'planet' (default) uses heliocentric/geocentric VSOP87. 'cardioid' uses multiplication-table chords. */
  kind?: PatternKind;
  /** Planet-pattern fields — required when kind is 'planet' (or undefined). Optional for cardioid. */
  planet1?: string;
  planet2?: string;
  au1?: number;
  au2?: number;
  period1?: number;
  period2?: number;
  simYears: number;     // years for one full pattern cycle (cardioid: cycle length for the draw animation)
  petals: number;       // approximate petal count (visual descriptor)
  captions: PatternCaption[];
  geocentric?: boolean;              // true = Earth at center (default: heliocentric); planet-only
  eccentricity1?: number;            // inner body orbital eccentricity; planet-only
  precessionPeriodYears1?: number;   // perigee precession period (years); planet-only
  /** Cardioid generator parameters — required when kind is 'cardioid'. */
  cardioid?: CardioidConfig;
}

// ─── Pattern Catalogue ────────────────────────────────────────

export const PATTERNS: PlanetaryPattern[] = [
  {
    id: 'venus-earth',
    name: 'Pentagram of Venus',
    planet1: 'Venus',
    planet2: 'Earth',
    au1: 0.723,
    au2: 1.0,
    period1: 224.7,
    period2: 365.25,
    simYears: 8,
    petals: 5,
    captions: [
      { atProgress: 0.00, text: 'Venus and Earth begin their dance...', duration: 4 },
      { atProgress: 0.15, text: 'A line connects the two planets at each moment in time.', duration: 5 },
      { atProgress: 0.35, text: 'Venus completes 13 orbits while Earth completes 8.', duration: 5 },
      { atProgress: 0.60, text: 'Together they trace a 5-petaled rose.', duration: 5 },
      { atProgress: 0.85, text: 'The Pentagram of Venus — known since antiquity.', duration: 4 },
      { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
    ],
  },
  {
    id: 'earth-mars',
    name: 'Flower of Mars',
    planet1: 'Earth',
    planet2: 'Mars',
    au1: 1.0,
    au2: 1.524,
    period1: 365.25,
    period2: 687.0,
    simYears: 15,
    petals: 7,
    captions: [
      { atProgress: 0.00, text: 'Earth and Mars begin their slower waltz...', duration: 4 },
      { atProgress: 0.15, text: 'Mars takes nearly two Earth years to orbit the Sun.', duration: 5 },
      { atProgress: 0.35, text: 'Over 15 years, Earth laps Mars seven times.', duration: 5 },
      { atProgress: 0.60, text: 'Seven petals bloom between the orbits.', duration: 5 },
      { atProgress: 0.85, text: 'The Flower of Mars — a pattern of patience.', duration: 4 },
      { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
    ],
  },
  {
    id: 'mercury-venus',
    name: 'Mercury-Venus Rosette',
    planet1: 'Mercury',
    planet2: 'Venus',
    au1: 0.387,
    au2: 0.723,
    period1: 87.97,
    period2: 224.7,
    simYears: 5,
    petals: 6,
    captions: [
      { atProgress: 0.00, text: 'Mercury and Venus — the two inner worlds...', duration: 4 },
      { atProgress: 0.15, text: 'Mercury races around the Sun in just 88 days.', duration: 5 },
      { atProgress: 0.35, text: 'In 5 years, their lines weave a tight rosette.', duration: 5 },
      { atProgress: 0.60, text: 'A hidden symmetry emerges from simple orbital motion.', duration: 5 },
      { atProgress: 0.85, text: 'The Mercury-Venus Rosette — delicate and dense.', duration: 4 },
      { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
    ],
  },
  {
    id: 'mercury-earth',
    name: "Mercury's Web",
    planet1: 'Mercury',
    planet2: 'Earth',
    au1: 0.387,
    au2: 1.0,
    period1: 87.97,
    period2: 365.25,
    simYears: 7,
    petals: 22,
    captions: [
      { atProgress: 0.00, text: 'Mercury and Earth — the messenger and the home world...', duration: 4 },
      { atProgress: 0.15, text: 'Mercury orbits over four times faster than Earth.', duration: 5 },
      { atProgress: 0.35, text: 'Dozens of petals emerge from their speed difference.', duration: 5 },
      { atProgress: 0.60, text: 'An intricate web fills the space between their orbits.', duration: 5 },
      { atProgress: 0.85, text: "Mercury's Web — complexity from simplicity.", duration: 4 },
      { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
    ],
  },
  {
    id: 'earth-jupiter',
    name: "Jupiter's Crown",
    planet1: 'Earth',
    planet2: 'Jupiter',
    au1: 1.0,
    au2: 5.203,
    period1: 365.25,
    period2: 4332.6,
    simYears: 12,
    petals: 11,
    captions: [
      { atProgress: 0.00, text: 'Earth and Jupiter — the small and the giant...', duration: 4 },
      { atProgress: 0.15, text: 'Jupiter takes nearly 12 Earth years to orbit once.', duration: 5 },
      { atProgress: 0.35, text: 'Earth races around 11 times before the pattern closes.', duration: 5 },
      { atProgress: 0.60, text: 'Eleven pointed rays crown the king of planets.', duration: 5 },
      { atProgress: 0.85, text: "Jupiter's Crown — a pattern of scale and grandeur.", duration: 4 },
      { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
    ],
  },
  // LEGACY (2026-06-06): the original 'lunar-hexagon' drew instantaneous
  // Moon→Sun *chords* (geocentric: true → calculateGeocentricLines). Replaced
  // by the stroboscopic 'moon-earth' hexagon below, which plots the Moon's own
  // position sampled per Sun-Earth-View. Kept here in case the chord variant is
  // revived; calculateGeocentricLines is still live for other geocentric uses.
  // {
  //   id: 'lunar-hexagon', name: 'Lunar Hexagon', planet1: 'Moon', planet2: 'Sun',
  //   au1: 0.00257, au2: 1.0, period1: 27.32, period2: 365.25, simYears: 17.9,
  //   petals: 6, geocentric: true, eccentricity1: 0.0549, precessionPeriodYears1: 8.85,
  //   captions: [ ...Moon↔Sun chord narration... ],
  // },
  {
    id: 'moon-earth',
    name: 'Moon - Earth',
    kind: 'moon-hexagon',
    planet1: 'Moon',
    planet2: 'Earth',        // display label only; geometry is Moon-about-Earth
    au1: 0.00257,            // Moon semi-major axis (~384,400 km)
    au2: 1.0,                // kept for catalogue symmetry; unused by the geometry
    period1: 27.5545,        // anomalistic month — drives the Moon's distance phase
    period2: 365.2422,       // tropical year — Sun longitude, for syzygy detection
    simYears: 44,            // ~one full hexagon (588 Sun-Earth-Views); explorable via sample rate
    petals: 6,
    eccentricity1: 0.0549,
    precessionPeriodYears1: 8.85,   // apsidal precession; with period1 → sidereal longitude
    captions: [
      { atProgress: 0.00, text: 'The Moon, seen from Earth at each Sun-Earth-View...', duration: 4 },
      { atProgress: 0.08, text: 'One position every 27.275 days — the Sun’s synodic rotation.', duration: 5 },
      { atProgress: 0.30, text: 'Each view, the Moon falls a little behind — the dots drift.', duration: 5 },
      { atProgress: 0.55, text: 'Its distance swells and shrinks six times per turn.', duration: 5 },
      { atProgress: 0.75, text: 'Six corners emerge: the Lunar Hexagon.', duration: 5 },
      { atProgress: 0.88, text: 'Bright dots mark eclipses — Sun, Earth and Moon in a line.', duration: 4 },
      { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
    ],
  },
  {
    // Non-planetary pattern. Lives at the end of the menu — separate from the
    // planet link-line family. Sample rate (state.sampleRate) doubles as N here.
    id: 'cardioid',
    name: 'Cardioid (Multiplication Table)',
    kind: 'cardioid',
    cardioid: { multiplier: 2, radius: 300 },
    simYears: 1,
    petals: 1,
    captions: [
      { atProgress: 0.00, text: 'A circle. N evenly-spaced points around it.', duration: 4 },
      { atProgress: 0.25, text: 'For each point i, draw a chord to point (i × n) mod N.', duration: 5 },
      { atProgress: 0.55, text: 'n = 2 reveals a cardioid. n = 3 a nephroid. Higher n curls tighter.', duration: 5 },
      { atProgress: 0.85, text: 'Same probe, different geometry — slide n to hear the math change.', duration: 4 },
      { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Compute a pixels-per-AU scale factor so the outer orbit fills
 * roughly 40% of the smaller canvas dimension. Cardioid patterns return 1
 * (no AU scaling — they use absolute pixel radius).
 */
export function computeAuScale(pattern: PlanetaryPattern, canvasMinDim: number): number {
  if (pattern.kind === 'cardioid') return 1;
  const targetRadius = canvasMinDim * 0.4;
  if (pattern.kind === 'moon-hexagon') {
    // Scale by the Moon's own apogee distance — NOT max(au1, au2). The Sun's
    // 1.0 AU is irrelevant here; scaling to it would render the flower microscopic.
    const apogeeAu = (pattern.au1 ?? 0.00257) * (1 + (pattern.eccentricity1 ?? 0));
    return targetRadius / apogeeAu;
  }
  const maxAu = Math.max(pattern.au1 ?? 1, pattern.au2 ?? 1);
  return targetRadius / maxAu;
}

/**
 * Render a small thumbnail canvas showing the full pattern.
 * Uses a low sample rate for speed.  Returns an offscreen canvas element.
 */
export function renderPatternThumbnail(
  pattern: PlanetaryPattern,
  size: number,
  lineColor: string = 'rgba(194, 118, 46, 0.35)',
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;

  let lines: LinkLine[];
  if (pattern.kind === 'cardioid' && pattern.cardioid) {
    // Thumbnail: scale the cardioid to fit ~80% of the thumbnail size.
    // Use a fixed point count for thumbnails (live N comes from state.sampleRate
    // but thumbnails are rendered without state context).
    const thumbRadius = size * 0.40;
    const thumbN = 200;
    lines = calculateCardioidLines(
      cx, cy,
      thumbN, pattern.cardioid.multiplier, thumbRadius,
    );
  } else if (pattern.kind === 'moon-hexagon') {
    const scale = computeAuScale(pattern, size);
    const a = (pattern.au1 ?? 0.00257) * scale;
    lines = calculateMoonHexagonLines(
      cx, cy, 588,
      a, pattern.eccentricity1 ?? 0,
      pattern.period1 ?? 27.5545,
      (pattern.precessionPeriodYears1 ?? 8.85) * 365.25,
    );
  } else if (pattern.geocentric) {
    const scale = computeAuScale(pattern, size);
    const r1 = (pattern.au1 ?? 0) * scale;
    const r2 = (pattern.au2 ?? 0) * scale;
    lines = calculateGeocentricLines(
      cx, cy, 300,
      r2, r1,
      pattern.period2 ?? 365.25, pattern.period1 ?? 27.32,
      pattern.simYears,
      pattern.eccentricity1 ?? 0,
      pattern.precessionPeriodYears1 ?? 1000,
    );
  } else {
    const scale = computeAuScale(pattern, size);
    lines = calculateEllipticalLines(
      cx, cy, 300,
      pattern.planet1 ?? 'Earth', pattern.planet2 ?? 'Venus',
      pattern.simYears, scale,
    );
  }

  g.strokeStyle = lineColor;
  g.lineWidth = 0.5;
  for (const line of lines) {
    g.beginPath();
    g.moveTo(line.p1.x, line.p1.y);
    g.lineTo(line.p2.x, line.p2.y);
    g.stroke();
  }

  return c;
}
