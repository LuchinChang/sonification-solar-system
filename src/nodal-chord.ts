// src/nodal-chord.ts
//
// Nodal Chord synthesis — deliberately raw WebAudio, NOT Strudel (ADR 0003:
// continuous un-snapped frequencies, ring-mod/FM operators, sustained organ
// envelopes, live knob response). Voices route through getChordBus() (the
// master compressor), so global mute and the single gesture-unlock apply.
//
// Timbre model: each voice is TWO partials — the pair's two orbital
// sinusoids — at frequency ratio k:m (the pattern's resonance, inner/outer
// orbit counts) or a free ratio, combined by the chosen operator:
//   add  — PeriodicWave with the two partials as integer harmonics of their
//          common fundamental (phase knob rotates partial 2); falls back to
//          two summed oscillators in free mode (no integer harmonics → no
//          PeriodicWave, phase knob inert).
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
      // The two partials sit at freq and freq·ratio with ratio = p/q rational
      // by construction — recover the small integers so both are harmonics
      // p and q of the common fundamental freq/q, encodable as a PeriodicWave
      // (which is what makes the phase knob physically meaningful).
      let p = 0, q = 1;
      for (let den = 1; den <= 64; den++) {
        const num = Math.round(v.ratio * den);
        if (num > 0 && Math.abs(v.ratio - num / den) < 1e-9) { p = num; q = den; break; }
      }
      if (p > 0) {
        const len = Math.max(p, q) + 1;
        const real = new Float32Array(len);
        const imag = new Float32Array(len);
        const phi = (s.phaseDeg * Math.PI) / 180;
        // x(t) = Σ real[n]·cos(nωt) + imag[n]·sin(nωt);
        // partial 1: sin(qωt) → imag[q]; partial 2: sin(pωt + φ).
        imag[q] += 1 - s.balance;
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
