// src/pattern-preview.ts
//
// The selector's Preview pane (CONTEXT.md: fast, looping, disposable — never
// touches the field or the user's probes). A small rAF loop redraws the
// selected pattern's lines progressively, then holds the finished figure.

import { computePatternLines, type PlanetaryPattern } from './patterns';
import type { LinkLine } from './engine';

export const PREVIEW_LOOP_MS = 3000;
/** Fraction of the loop spent holding the completed figure before restarting. */
export const PREVIEW_HOLD_FRACTION = 0.25;
/** Line density for planet-pair previews (denser than 120px thumbnails). */
export const PREVIEW_SAMPLES = 400;

/** Map loop position 0..1 to the fraction of lines drawn. */
export function previewLineFraction(loopT: number): number {
  return Math.min(loopT / (1 - PREVIEW_HOLD_FRACTION), 1);
}

export interface PreviewLoop {
  /** Swap the previewed pattern and restart the loop (starts it if stopped). */
  setPattern(p: PlanetaryPattern): void;
  /** Cancel the rAF loop (call whenever the selector closes). */
  stop(): void;
}

export function createPreviewLoop(
  canvas: HTMLCanvasElement,
  getLineColor: () => string,
): PreviewLoop {
  const g = canvas.getContext('2d')!;
  let lines: LinkLine[] = [];
  let raf = 0;
  let startTime = 0;

  function frame(now: number): void {
    if (startTime === 0) startTime = now;
    const loopT = ((now - startTime) % PREVIEW_LOOP_MS) / PREVIEW_LOOP_MS;
    const count = Math.floor(previewLineFraction(loopT) * lines.length);
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
    raf = requestAnimationFrame(frame);
  }

  return {
    setPattern(p: PlanetaryPattern): void {
      lines = computePatternLines(p, canvas.width, PREVIEW_SAMPLES);
      startTime = 0;
      if (raf === 0) raf = requestAnimationFrame(frame);
    },
    stop(): void {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      startTime = 0;
    },
  };
}
