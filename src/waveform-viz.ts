// src/waveform-viz.ts
//
// The playground's waveform display: what ONE Nodal Chord voice looks like —
// its two orbital-sinusoid partials and their combination under the chosen
// operator. A mathematical mirror of nodal-chord.ts's buildVoice (NOT an
// AnalyserNode tap: the live chord is many voices summed, which reads as
// mush; the timbre's anatomy is per-voice). Sampled over one closed
// fundamental period so the trace tiles seamlessly.
//
// Math is pure and unit-tested; drawWaveform is the only canvas code.

import type { PlaygroundSettings } from './playground-settings';
import type { PairResonanceLike } from './nodal-chord';
import { NODAL_GLOW_COLOR } from './pattern-preview';

/** Cap on visible oscillations — extreme resonances (411:100) would smear. */
export const MAX_CYCLES_SHOWN = 24;

export interface WaveSamples {
  /** Partial 1 — the inner voice's base sinusoid (FM carrier). */
  partial1: number[];
  /** Partial 2 — the ratio-locked sinusoid (FM/ring modulator), phase-shifted. */
  partial2: number[];
  /** The combined waveform, peak-normalized to |1|. */
  combined: number[];
  /** Oscillations of the faster partial actually displayed. */
  cyclesShown: number;
  /** Human-readable ratio, e.g. "13:8" or "×2". */
  ratioLabel: string;
}

/** Sample one voice's partials + combination over one fundamental period. */
export function computeWaveSamples(
  s: PlaygroundSettings,
  resonance: PairResonanceLike,
  n: number,
): WaveSamples {
  // Harmonic numbers of the common fundamental: partial 1 = q, partial 2 = p.
  // Free mode has no integer closure — show 4 carrier cycles instead.
  const free = s.ratioMode === 'free';
  const q = free ? 4 : resonance.outerOrbits;
  const p = free ? 4 * s.freeRatio : resonance.innerOrbits;
  const ratioLabel = free ? `×${s.freeRatio}` : `${resonance.innerOrbits}:${resonance.outerOrbits}`;

  const fastest = Math.max(p, q);
  const window = Math.min(1, MAX_CYCLES_SHOWN / fastest);
  const phi = (s.phaseDeg * Math.PI) / 180;

  const partial1: number[] = new Array(n);
  const partial2: number[] = new Array(n);
  const combined: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = (window * i) / n;
    partial1[i] = Math.sin(2 * Math.PI * q * t);
    partial2[i] = Math.sin(2 * Math.PI * p * t + phi);
    if (s.operator === 'add') {
      combined[i] = (1 - s.balance) * partial1[i] + s.balance * partial2[i];
    } else if (s.operator === 'ring') {
      combined[i] = partial1[i] * partial2[i];
    } else {
      // fm: carrier at q, phase-modulated by the p partial; modulation index
      // = fmIndex (deviation I·f_mod ÷ f_mod), matching buildVoice's depth.
      combined[i] = Math.sin(2 * Math.PI * q * t + s.fmIndex * Math.sin(2 * Math.PI * p * t + phi));
    }
  }

  const peak = Math.max(...combined.map(Math.abs));
  if (peak > 1e-12) for (let i = 0; i < n; i++) combined[i] /= peak;

  return { partial1, partial2, combined, cyclesShown: fastest * window, ratioLabel };
}

/** Trace colours — partials echo the Martian Dusk field, combined = nodal violet. */
export const PARTIAL1_COLOR = 'rgba(194, 118, 46, 0.8)';
export const PARTIAL2_COLOR = 'rgba(94, 155, 168, 0.8)';
export const COMBINED_COLOR = NODAL_GLOW_COLOR;

/** Paint the three traces onto the drawer's strip canvas. */
export function drawWaveform(canvas: HTMLCanvasElement, w: WaveSamples): void {
  const g = canvas.getContext('2d');
  if (g === null) return;
  const W = canvas.width;
  const H = canvas.height;
  const mid = H / 2;
  const amp = H * 0.42;
  g.clearRect(0, 0, W, H);

  // Midline
  g.strokeStyle = 'rgba(128, 128, 128, 0.25)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(W, mid);
  g.stroke();

  const trace = (vals: number[], color: string, width: number): void => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const x = (i / (vals.length - 1)) * W;
      const y = mid - vals[i] * amp;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };

  trace(w.partial1, PARTIAL1_COLOR, 1);
  trace(w.partial2, PARTIAL2_COLOR, 1);
  trace(w.combined, COMBINED_COLOR, 2);
}
