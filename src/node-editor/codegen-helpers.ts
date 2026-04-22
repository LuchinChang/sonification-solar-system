// src/node-editor/codegen-helpers.ts
//
// Unit 4 — Pitch chromatic quantization helper.
//
// Strudel's `.note()` expects a note name string (e.g. 'c4', 'g#3') and
// chokes on raw numeric signals. When the user wires a 0–1 distance signal
// into `sound.pitch`, we wrap it with `__sw_quantizeNote(x, root, span)`
// which snaps the continuous value onto a chromatic scale starting at
// `root`, spanning `span` semitones.
//
// Published onto globalThis so generated Strudel code can call it from
// inside `signal(() => ...)` — matches the existing `__sw_*` convention
// used by src/shapes.ts `_publishSensorGlobals`.

const NOTE_NAMES: ReadonlyArray<string> =
  ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

/**
 * Quantize a 0–1 value to a note name on a chromatic scale.
 *
 *   x=0      → `root`
 *   x=1-ε    → root + (span-1) semitones
 *   x≥1      → clamped, will NOT overflow to the next octave above span
 *   x<0      → clamped to `root`
 *
 * Examples:
 *   __sw_quantizeNote(0,     'c4', 12) === 'c4'
 *   __sw_quantizeNote(0.5,   'c4', 12) === 'f#4'
 *   __sw_quantizeNote(0.999, 'c4', 12) === 'b4'
 */
export function quantizeNote(x: number, root: string, span: number): string {
  const match = /^([a-g])(#?)(-?\d+)$/.exec(root.toLowerCase());
  if (!match) return 'c4';
  const noteIdx  = NOTE_NAMES.indexOf(match[1] + match[2]);
  const octave   = parseInt(match[3]!, 10);
  if (noteIdx < 0 || !Number.isFinite(octave)) return 'c4';

  // MIDI convention used by Strudel / Tone.js: C4 = 60 ⇒ C-1 = 0 ⇒ rootMidi = (oct+1)*12 + idx
  const rootMidi = (octave + 1) * 12 + noteIdx;

  // Clamp span to a sane range and x to [0, 1). Floor to semitone offset.
  const safeSpan = Number.isFinite(span) && span > 0 ? Math.floor(span) : 12;
  const clamped  = Math.max(0, Math.min(0.99999, x));
  const semi     = Math.floor(clamped * safeSpan);

  const midi       = rootMidi + semi;
  const pitchClass = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct        = Math.floor(midi / 12) - 1;
  return `${pitchClass}${oct}`;
}

/**
 * Install the quantize helper onto globalThis so generated Strudel code can
 * call it from inside `signal(() => ...)`. Idempotent — safe to call at
 * boot and from tests.
 */
export function installQuantizeHelper(): void {
  (globalThis as unknown as Record<string, unknown>)['__sw_quantizeNote'] = quantizeNote;
}
