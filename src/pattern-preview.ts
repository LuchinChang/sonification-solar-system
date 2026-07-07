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
      // Nodal points sit in the figure's densest pixels by definition, so the
      // glow must punch through: additive halo + bright core + breathing ring.
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const p of hooks.getNodalPoints()) {
        const r = 4 + 5 * glow;
        const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5);
        halo.addColorStop(0, NODAL_GLOW_COLOR);
        halo.addColorStop(1, 'rgba(192, 132, 252, 0)');
        g.globalAlpha = 0.35 + 0.65 * glow;
        g.fillStyle = halo;
        g.beginPath();
        g.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 0.5 + 0.5 * glow;
        g.strokeStyle = NODAL_GLOW_COLOR;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
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
