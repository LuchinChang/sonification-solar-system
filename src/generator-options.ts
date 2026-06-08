// src/generator-options.ts
//
// Canonical option table for the sweeper Generator dropdown. Lives at the src/
// root (not under node-editor/) because BOTH the model (shapes.ts, which bakes
// the sweeper's Strudel via _toSweeperCode) and the node editor (codegen.ts,
// sweeper.ts) resolve instrument keys through it — keeping it a neutral leaf
// avoids a model→node-editor import.
//
// Each option has a stable selection `key` (stored in CanvasShape.instrument and
// serialized via toConfig), a user-facing `label`, and the Strudel `osc` it
// currently sounds as.
//
// PLACEHOLDER: the four Signature Waveforms are reserved sound identities that
// all resolve to 'sine' for now — they sit alongside the real oscillators
// (Sine/Triangle/Square/Saw), which keep their own sound. When bespoke synthesis
// lands, only the `osc` mapping (or the codegen behind it) changes here; the
// keys and labels stay, so saved sweepers and the user's selection survive the
// upgrade. The split key↔osc is what lets "Signature Waveform 1" and "Sine"
// coexist while both sounding like sine — the <select> round-trips on the key,
// codegen runs on the resolved oscillator.

export interface GeneratorOption {
  /** Stable id stored in CanvasShape.instrument and serialized. */
  key: string;
  /** Text shown in the dropdown. */
  label: string;
  /** Strudel oscillator this selection currently sounds as. */
  osc: string;
}

export const GENERATOR_OPTIONS: readonly GeneratorOption[] = [
  { key: 'sig1', label: 'Signature Waveform 1', osc: 'sine' },
  { key: 'sig2', label: 'Signature Waveform 2', osc: 'sine' },
  { key: 'sig3', label: 'Signature Waveform 3', osc: 'sine' },
  { key: 'sig4', label: 'Signature Waveform 4', osc: 'sine' },
  { key: 'sine',     label: 'Sine',     osc: 'sine' },
  { key: 'triangle', label: 'Triangle', osc: 'triangle' },
  { key: 'square',   label: 'Square',   osc: 'square' },
  { key: 'sawtooth', label: 'Saw',      osc: 'sawtooth' },
] as const;

/** Default selection for a freshly spawned sweeper (mirrored in shapes.ts). */
export const DEFAULT_GENERATOR_KEY = 'sig1';

const OSC_BY_KEY = new Map(GENERATOR_OPTIONS.map(o => [o.key, o.osc]));

/**
 * Resolve a Generator selection key to the Strudel oscillator it sounds as.
 * Unknown keys pass through unchanged so legacy/drum instruments
 * (`bd`, `superpiano`, `gm_acoustic_bass`, …) and raw oscillator names still work.
 */
export function resolveOscillator(key: string): string {
  return OSC_BY_KEY.get(key) ?? key;
}
