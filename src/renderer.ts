// src/renderer.ts
//
// Canvas rendering pipeline: background, sun, orbital lines, shapes,
// dust particles, and signature watermark.
// Pure functions of (ctx, state) — no module-level closures.

import type { AppState, DustMote } from './state';
import { DUST_COUNT, CANVAS_THEMES } from './state';

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

  const cx = w / 2;
  const cy = h / 2;

  // Sun (radial glow + solid core + breathing pulse)
  const breathPhase = Math.sin(performance.now() / 4000 * Math.PI * 2);
  const glowRadius = 34 + breathPhase * 8;
  const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  sunGlow.addColorStop(0,   ct.sunGlow0);
  sunGlow.addColorStop(0.5, ct.sunGlow1);
  sunGlow.addColorStop(1,   ct.sunGlow2);
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fillStyle = sunGlow;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = ct.sunCore;
  ctx.fill();

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

  // Ambient dust particles
  updateAndDrawDust(ctx, state.dustMotes, 16, w, h, cx, cy, state.currentTheme === 'dark');

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
