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
