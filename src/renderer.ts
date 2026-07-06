// src/renderer.ts
//
// Canvas rendering pipeline: background, sun, orbital lines, shapes,
// dust particles, and signature watermark.
// Pure functions of (ctx, state) — no module-level closures.

import type { AppState, DustMote } from './state';
import { DUST_COUNT, CANVAS_THEMES } from './state';
import { planetDiscAlpha } from './reveal';

// ── Dust particle system ─────────────────────────────────────────────────────

export function initDust(motes: DustMote[]): void {
  for (let i = 0; i < DUST_COUNT; i++) {
    motes.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00004,
      vy: (Math.random() - 0.5) * 0.00004,
      r: 0.8 + Math.random() * 1.5,
      baseAlpha: 0.04 + Math.random() * 0.08,
    });
  }
}

export function updateAndDrawDust(
  ctx: CanvasRenderingContext2D,
  motes: DustMote[],
  dt: number,
  canvasW: number,
  canvasH: number,
  cx: number,
  cy: number,
  isDark: boolean,
): void {
  const maxDist = Math.hypot(canvasW, canvasH) * 0.5;

  for (const m of motes) {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.x < 0) m.x += 1; if (m.x > 1) m.x -= 1;
    if (m.y < 0) m.y += 1; if (m.y > 1) m.y -= 1;

    const px = m.x * canvasW;
    const py = m.y * canvasH;
    const dist = Math.hypot(px - cx, py - cy);
    const sunProximity = 1 - Math.min(dist / maxDist, 1);
    const alpha = m.baseAlpha + sunProximity * 0.10;

    ctx.beginPath();
    ctx.arc(px, py, m.r, 0, Math.PI * 2);
    ctx.fillStyle = isDark
      ? `rgba(194, 118, 46, ${alpha})`
      : `rgba(120, 80, 40, ${alpha * 0.7})`;
    ctx.fill();
  }
}

// ── Main scene renderer ──────────────────────────────────────────────────────

export function drawScene(ctx: CanvasRenderingContext2D, state: AppState): void {
  const ct = CANVAS_THEMES[state.currentTheme];
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.fillStyle = ct.bg;
  ctx.fillRect(0, 0, w, h);

  // LEGACY (2026-06-06): Sun glyph removed — visually irrelevant to the
  // link-lines, per user request. The simulation still anchors at the canvas
  // center via sunPos()/state and sweeper arms still emanate from it; this only
  // drops the *drawn* sun. cx/cy lived here solely to position the sun glow and
  // the dust sun-proximity falloff (dust draw also removed below), so they are
  // quarantined together to keep `tsc --noEmit` (noUnusedLocals) happy.
  // To revive: uncomment this block AND the dust draw call further down.
  // const cx = w / 2;
  // const cy = h / 2;
  //
  // // Sun (radial glow + solid core + breathing pulse)
  // const breathPhase = Math.sin(performance.now() / 4000 * Math.PI * 2);
  // const glowRadius = 34 + breathPhase * 8;
  // const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  // sunGlow.addColorStop(0,   ct.sunGlow0);
  // sunGlow.addColorStop(0.5, ct.sunGlow1);
  // sunGlow.addColorStop(1,   ct.sunGlow2);
  // ctx.beginPath();
  // ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  // ctx.fillStyle = sunGlow;
  // ctx.fill();
  //
  // ctx.beginPath();
  // ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  // ctx.fillStyle = ct.sunCore;
  // ctx.fill();

  // Orbital link lines (progressive during draw animation)
  ctx.strokeStyle = ct.linkLine;
  ctx.lineWidth   = 1;
  const linesToDraw = state.drawAnimActive ? state.drawLineCount : state.linkLines.length;
  for (let i = 0; i < linesToDraw; i++) {
    const line = state.linkLines[i];
    ctx.beginPath();
    ctx.moveTo(line.p1.x, line.p1.y);
    ctx.lineTo(line.p2.x, line.p2.y);
    ctx.stroke();
  }

  // Reveal guided phase: draw the two planet bodies at the newest revealed
  // line's endpoints, with a bright live chord between them — making the CAUSE
  // of each link line visible. calculateEllipticalLines orders every line as
  // p1 = planet1 (the pair's inner planet), p2 = planet2 (outer). Planet-pair
  // patterns only: moon-hexagon lines are a polyline of Moon positions and the
  // cardioid has no bodies at all.
  const isPlanetPair =
    (state.currentPattern.kind ?? 'planet') === 'planet' && !state.currentPattern.geocentric;
  if (state.drawAnimActive && isPlanetPair && state.drawLineCount > 0) {
    const alpha = planetDiscAlpha(state.drawAnimProgress, state.drawGuidedTimeFrac);
    if (alpha > 0) {
      const newest = state.linkLines[Math.min(state.drawLineCount, state.linkLines.length) - 1];
      const isDark = state.currentTheme === 'dark';

      ctx.save();
      ctx.globalAlpha = alpha;

      // Live chord — brighter than the settled lines behind it
      ctx.strokeStyle = isDark ? 'rgba(255, 190, 100, 0.9)' : 'rgba(140, 80, 30, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(newest.p1.x, newest.p1.y);
      ctx.lineTo(newest.p2.x, newest.p2.y);
      ctx.stroke();

      const disc = (p: { x: number; y: number }, label: string) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#FFB870' : '#8C501E';
        ctx.fill();
        ctx.font = '500 11px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isDark ? 'rgba(255, 220, 180, 0.95)' : 'rgba(70, 40, 15, 0.95)';
        ctx.fillText(label, p.x + 10, p.y);
      };
      disc(newest.p1, state.currentPattern.planet1 ?? '');
      disc(newest.p2, state.currentPattern.planet2 ?? '');
      ctx.restore();
    }
  }

  // Moon-hexagon: a dot at each Sun-Earth-View position, so the figure reads as
  // "positions + connecting lines" (like Hartmut's). Other patterns draw lines
  // only. Reveal count tracks the draw-in via drawLineCount.
  if (state.currentPattern.kind === 'moon-hexagon' && state.linkLines.length > 0) {
    ctx.save();
    ctx.fillStyle = state.currentTheme === 'dark'
      ? 'rgba(194, 118, 46, 0.9)'
      : 'rgba(92, 58, 33, 0.75)';
    const dotCount = state.drawAnimActive ? state.drawLineCount : state.linkLines.length;
    const first = state.linkLines[0].p1;
    ctx.beginPath(); ctx.arc(first.x, first.y, 1.3, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < dotCount; i++) {
      const p = state.linkLines[i].p2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // Shapes, intersection dots, playheads, trigger rings
  for (const shape of state.shapes) {
    shape.draw(ctx);

    const dotColor = shape.accentColor;
    for (const int of shape.cachedIntersections) {
      ctx.beginPath();
      ctx.arc(int.x, int.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }

    shape.drawAnimations(ctx);
    shape.drawPlayhead(ctx);
  }

  // LEGACY (2026-06-06): Ambient dust particles removed — visually irrelevant
  // to the link-lines, per user request. initDust()/state.dustMotes + their
  // tests stay intact; only the per-frame draw is dropped. To revive, uncomment
  // this AND restore cx/cy in the sun block above (dust uses them for the
  // sun-proximity brightness falloff).
  // updateAndDrawDust(ctx, state.dustMotes, 16, w, h, cx, cy, state.currentTheme === 'dark');

  // LC signature monogram
  ctx.save();
  ctx.font = '500 10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = state.currentTheme === 'dark'
    ? 'rgba(120, 88, 55, 0.35)'
    : 'rgba(92, 58, 33, 0.30)';
  ctx.fillText('LC', 16, h - 12);
  ctx.restore();
}
