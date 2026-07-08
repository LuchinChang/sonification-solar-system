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
