// src/main.ts
import './style.css';
import type { Point } from './geometry';
import { CanvasShape, type ShapeType, type PlaybackMode } from './shapes';
import { calculateLines as _calculateLines, clamp } from './engine';
import { PATTERNS, computeAuScale, renderPatternThumbnail, type PlanetaryPattern } from './patterns';
import { repl, evalScope } from '@strudel/core';
import { initAudioOnFirstClick, initAudio, getAudioContext, webaudioOutput, registerSynthSounds } from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';

// ═══════════════════════════════════════════════════════════════
// CANVAS SETUP
// ═══════════════════════════════════════════════════════════════

const canvas = document.getElementById('simCanvas') as HTMLCanvasElement;
const ctx    = canvas.getContext('2d')!;

function resize(): void {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  // Recompute AU scale for current pattern to fit new viewport
  if (currentPattern) {
    const minDim = Math.min(canvas.width, canvas.height);
    currentAuScale = computeAuScale(currentPattern, minDim);
    currentOuterR = Math.max(currentPattern.au1, currentPattern.au2) * currentAuScale;
    currentInnerR = Math.min(currentPattern.au1, currentPattern.au2) * currentAuScale;
    ORBITAL_MAX_RADIUS = currentOuterR * 1.05;
  }
  calculateLines();
  drawScene();
}
window.addEventListener('resize', resize);

// ═══════════════════════════════════════════════════════════════
// ORBITAL ENGINE  (pattern-driven, mutable geometry)
// ═══════════════════════════════════════════════════════════════

let currentPattern: PlanetaryPattern = PATTERNS[0];
let currentAuScale   = 300;
let currentOuterR    = 1.0   * 300;     // outer planet orbital radius (px)
let currentInnerR    = 0.723 * 300;     // inner planet orbital radius (px)
let currentOuterPeriod = 365.25;        // outer planet orbital period (days)
let currentInnerPeriod = 224.7;         // inner planet orbital period (days)
let currentSimYears    = 8;

// Orbital bounds: furthest point from Sun (used for sweeper line length normalization)
let ORBITAL_MAX_RADIUS = currentOuterR * 1.05;

let SAMPLE_RATE   = 500;
const MIN_SAMPLES = 10;
const MAX_SAMPLES = 2000;

let linkLines: { p1: Point; p2: Point }[] = [];
let fullLinkLines: { p1: Point; p2: Point }[] = [];

function calculateLines(): void {
  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;
  linkLines = _calculateLines(cx, cy, SAMPLE_RATE, currentOuterR, currentInnerR, currentOuterPeriod, currentInnerPeriod, currentSimYears);
  fullLinkLines = linkLines;
  rebuildAllCaches();
}

// ═══════════════════════════════════════════════════════════════
// DRAW ANIMATION STATE
// ═══════════════════════════════════════════════════════════════

let drawAnimActive     = false;
let drawAnimStartTime  = 0;
let drawAnimDurationMs = 0;       // simYears * 1500ms, capped at 25s
let drawAnimProgress   = 0;       // 0..1
let drawLineCount      = 0;       // how many lines to render this frame

// Caption state
let currentCaptionText = '';
let captionTimeoutId: ReturnType<typeof setTimeout> | null = null;

const captionEl = document.getElementById('draw-caption')!;
const toastEl   = document.getElementById('pattern-toast')!;

function startDrawAnimation(): void {
  drawAnimActive    = true;
  drawAnimStartTime = performance.now();
  drawAnimDurationMs = Math.min(currentPattern.simYears * 1500, 25000);
  drawAnimProgress  = 0;
  drawLineCount     = 0;
  currentCaptionText = '';

  // Show caption bar
  captionEl.classList.remove('hidden');
  captionEl.classList.remove('visible');
  captionEl.textContent = '';

  // Pause playback during animation
  if (isPlaying) togglePlayback();
}

function updateCaption(progress: number): void {
  const caps = currentPattern.captions;
  // Find the latest caption whose atProgress <= current progress
  let active: typeof caps[0] | null = null;
  for (let i = caps.length - 1; i >= 0; i--) {
    if (progress >= caps[i].atProgress) {
      active = caps[i];
      break;
    }
  }

  if (active && active.text !== currentCaptionText) {
    currentCaptionText = active.text;
    captionEl.textContent = active.text;
    captionEl.classList.add('visible');
    // Auto-hide after duration
    if (captionTimeoutId) clearTimeout(captionTimeoutId);
    captionTimeoutId = setTimeout(() => {
      captionEl.classList.remove('visible');
    }, active.duration * 1000);
  }
}

function finishDrawAnimation(): void {
  drawAnimActive = false;
  drawAnimProgress = 1;
  drawLineCount = fullLinkLines.length;
  linkLines = fullLinkLines;
  rebuildAllCaches();

  // Hide caption
  captionEl.classList.remove('visible');
  captionEl.classList.add('hidden');
  if (captionTimeoutId) clearTimeout(captionTimeoutId);
  currentCaptionText = '';

  // Show ready toast
  toastEl.textContent = 'Pattern ready \u2014 spawn shapes to explore';
  toastEl.classList.remove('hidden', 'fade-out');
  setTimeout(() => toastEl.classList.add('fade-out'), 2500);
  setTimeout(() => toastEl.classList.add('hidden'), 3200);
}

// ═══════════════════════════════════════════════════════════════
// PATTERN SELECTOR
// ═══════════════════════════════════════════════════════════════

const patternSelectorEl = document.getElementById('pattern-selector')!;
const patternCardsEl    = document.getElementById('pattern-cards')!;

function showPatternSelector(): void {
  // Pause if playing
  if (isPlaying) togglePlayback();

  // Stop any running draw animation
  if (drawAnimActive) {
    drawAnimActive = false;
    captionEl.classList.remove('visible');
    captionEl.classList.add('hidden');
    if (captionTimeoutId) clearTimeout(captionTimeoutId);
  }

  // Build cards
  patternCardsEl.innerHTML = '';
  const thumbColor = currentTheme === 'dark'
    ? 'rgba(194, 118, 46, 0.4)'
    : 'rgba(92, 58, 33, 0.35)';

  for (const pattern of PATTERNS) {
    const card = document.createElement('button');
    card.className = 'pattern-card';
    card.dataset['pattern'] = pattern.id;

    const thumb = renderPatternThumbnail(pattern, 120, thumbColor);
    thumb.className = 'pattern-thumb';
    card.appendChild(thumb);

    const planets = document.createElement('span');
    planets.className = 'pattern-card-planets';
    planets.textContent = `${pattern.planet1} \u2014 ${pattern.planet2}`;
    card.appendChild(planets);

    card.addEventListener('click', () => selectPattern(pattern.id));
    patternCardsEl.appendChild(card);
  }

  patternSelectorEl.classList.remove('hidden');
}

function hidePatternSelector(): void {
  patternSelectorEl.classList.add('hidden');
}

function selectPattern(patternId: string): void {
  const pattern = PATTERNS.find(p => p.id === patternId);
  if (!pattern) return;

  currentPattern = pattern;

  // Compute dynamic scale
  const minDim = Math.min(canvas.width, canvas.height);
  currentAuScale = computeAuScale(pattern, minDim);

  // Determine inner/outer by AU radius
  const au1 = Math.min(pattern.au1, pattern.au2);
  const au2 = Math.max(pattern.au1, pattern.au2);
  currentInnerR = au1 * currentAuScale;
  currentOuterR = au2 * currentAuScale;

  // Assign periods matching the inner/outer mapping
  if (pattern.au1 < pattern.au2) {
    currentInnerPeriod = pattern.period1;
    currentOuterPeriod = pattern.period2;
  } else {
    currentInnerPeriod = pattern.period2;
    currentOuterPeriod = pattern.period1;
  }
  currentSimYears = pattern.simYears;
  ORBITAL_MAX_RADIUS = currentOuterR * 1.05;

  // Calculate all link lines
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  fullLinkLines = _calculateLines(
    cx, cy, SAMPLE_RATE,
    currentOuterR, currentInnerR,
    currentOuterPeriod, currentInnerPeriod,
    currentSimYears,
  );
  linkLines = fullLinkLines;

  // Clear existing shapes (scale changed, caches invalid)
  while (shapes.length > 0) {
    shapes.pop();
  }
  activeShape = null;
  _flashCooldowns.clear();
  hideSoundMenu();
  updateTelemetry();

  // Hide selector, start animation
  hidePatternSelector();
  startDrawAnimation();
}

// ═══════════════════════════════════════════════════════════════
// SHAPE STATE
// ═══════════════════════════════════════════════════════════════

const shapes: CanvasShape[]         = [];
let   activeShape: CanvasShape | null = null;

const MIN_SHAPE_SIZE = 20;
const MAX_SHAPE_SIZE = 400;


const sunPos = (): { x: number; y: number } => ({
  x: canvas.width  / 2,
  y: canvas.height / 2,
});

function rebuildAllCaches(): void {
  for (const s of shapes) {
    s.rebuildIntersectionCache(linkLines);
    if (s.type === 'sweeper') s.rebuildSweepTicks(linkLines, ORBITAL_MAX_RADIUS);
  }
}

function spawnShape(type: ShapeType): void {
  const { x, y } = sunPos();
  // Sweepers extend to MAX_SHAPE_SIZE; other shapes use the constructor default
  const size = type === 'sweeper' ? MAX_SHAPE_SIZE : undefined;
  const s = new CanvasShape(x, y, type, size);
  shapes.push(s);
  s.rebuildIntersectionCache(linkLines);
  if (s.type === 'sweeper') s.rebuildSweepTicks(linkLines, ORBITAL_MAX_RADIUS);
  setActiveShape(s);
  hideSoundMenu();
  updateTelemetry();
  // Pre-warm Strudel compiler with the updated pattern so play starts instantly
  if (audioInitialized) playLiveCode(telemetryTextarea.value);
}

function setActiveShape(s: CanvasShape | null): void {
  shapes.forEach(sh => { sh.isSelected = false; });
  activeShape = s;
  if (s !== null) s.isSelected = true;
}

function deleteActiveShape(): void {
  if (activeShape === null) return;
  const idx = shapes.indexOf(activeShape);
  if (idx !== -1) shapes.splice(idx, 1);
  _flashCooldowns.delete(activeShape.id);
  activeShape = null;
  hideSoundMenu();
  updateTelemetry();   // update textarea only — no auto-eval
}

// ═══════════════════════════════════════════════════════════════
// SEQUENCER STATE
// ═══════════════════════════════════════════════════════════════

let CPM: number          = 10;
const MIN_CPM            = 5;
const MAX_CPM            = 100;
let playbackMode: PlaybackMode = 'constant-time';
let isPlaying            = false;
let lastFrameTime        = 0;

// Sweeper AC-clock sync: drive playheadAngle from AudioContext.currentTime instead of
// accumulated rAF deltaMs, eliminating clock drift vs. Strudel's WebAudio scheduler.
let sweepAudioRefTime = 0;   // ac.currentTime captured when strudelRepl.start() is called
let sweepPhaseAtRef   = 0;   // fractional cycle phase (0..1) accumulated up to that point

// ═══════════════════════════════════════════════════════════════
// THEME STATE — canvas colors tracked in JS, CSS vars for UI
// ═══════════════════════════════════════════════════════════════

type AppTheme = 'dark' | 'light';
let currentTheme: AppTheme = 'light';

interface CanvasThemeColors {
  bg: string;
  sunGlow0: string;
  sunGlow1: string;
  sunGlow2: string;
  sunCore: string;
  linkLine: string;
}

const CANVAS_THEMES: Record<AppTheme, CanvasThemeColors> = {
  dark: {
    bg:       '#120F0E',
    sunGlow0: 'rgba(255, 170, 60, 0.85)',
    sunGlow1: 'rgba(230, 100, 30, 0.35)',
    sunGlow2: 'rgba(180,  60, 10, 0)',
    sunCore:  '#FFA030',
    linkLine: 'rgba(194, 118, 46, 0.2)',
  },
  light: {
    bg:       '#F0EDE6',
    sunGlow0: 'rgba(255, 180, 50, 0.80)',
    sunGlow1: 'rgba(240, 120, 20, 0.30)',
    sunGlow2: 'rgba(200,  80, 10, 0)',
    sunCore:  '#F08010',
    linkLine: 'rgba(92, 58, 33, 0.2)',
  },
};

// ═══════════════════════════════════════════════════════════════
// STRUDEL AUDIO STATE
// ═══════════════════════════════════════════════════════════════

let strudelRepl: any = null;
let audioInitialized = false;

// ═══════════════════════════════════════════════════════════════
// AMBIENT DUST PARTICLES  (warm motes drifting through space)
// ═══════════════════════════════════════════════════════════════

interface DustMote {
  x: number;      // 0..1 normalised position
  y: number;
  vx: number;     // normalised velocity
  vy: number;
  r: number;      // radius in px
  baseAlpha: number;
}

const DUST_COUNT = 40;
const dustMotes: DustMote[] = [];

function initDust(): void {
  for (let i = 0; i < DUST_COUNT; i++) {
    dustMotes.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00004,
      vy: (Math.random() - 0.5) * 0.00004,
      r: 0.8 + Math.random() * 1.5,
      baseAlpha: 0.04 + Math.random() * 0.08,
    });
  }
}
initDust();

function updateAndDrawDust(dt: number): void {
  const w = canvas.width;
  const h = canvas.height;
  const { x: cx, y: cy } = sunPos();
  const maxDist = Math.hypot(w, h) * 0.5;
  const isDark = currentTheme === 'dark';

  for (const m of dustMotes) {
    // Drift
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    // Wrap
    if (m.x < 0) m.x += 1; if (m.x > 1) m.x -= 1;
    if (m.y < 0) m.y += 1; if (m.y > 1) m.y -= 1;

    const px = m.x * w;
    const py = m.y * h;
    const dist = Math.hypot(px - cx, py - cy);
    // Brighter near the sun
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

// ═══════════════════════════════════════════════════════════════
// CONTINUOUS ANIMATION LOOP  (performance.now() via rAF)
// ═══════════════════════════════════════════════════════════════

function animate(now: number): void {
  let dt = 0;
  if (isPlaying && lastFrameTime > 0) {
    dt = Math.min(now - lastFrameTime, 100);
  }
  lastFrameTime = now;

  if (isPlaying && dt > 0) {
    for (const shape of shapes) {
      if (shape.type === 'sweeper') {
        // Drive sweeper arm from AudioContext clock — stays in sync with Strudel's
        // WebAudio scheduler and eliminates rAF delta accumulation drift.
        // Guard: fall back to stepPlayhead if AC not yet running or ref not set.
        try {
          if (audioInitialized && sweepAudioRefTime > 0) {
            const cycleS = 60 / CPM;
            const phase  = (sweepPhaseAtRef +
              (getAudioContext().currentTime - sweepAudioRefTime) / cycleS) % 1;
            shape.prevPlayheadAngle = shape.playheadAngle;
            shape.playheadAngle     = (shape.startAngle + phase * Math.PI * 2) % (Math.PI * 2);
          } else {
            shape.stepPlayhead(dt, CPM, playbackMode);
          }
        } catch (_) {
          shape.stepPlayhead(dt, CPM, playbackMode);
        }
        shape.computeSweepClusters(linkLines, ORBITAL_MAX_RADIUS);
      } else {
        shape.stepPlayhead(dt, CPM, playbackMode);
        const triggered = shape.checkAndFireCollisions();
        if (triggered.length > 0) {
          for (const int of triggered) shape.triggerAt(int.x, int.y);
          flashTelemBlock(shape, now);
        }
        shape.stepAnimations();
      }
    }
  }

  // ── Progressive draw animation ──────────────────────────────
  if (drawAnimActive) {
    const elapsed = now - drawAnimStartTime;
    drawAnimProgress = Math.min(elapsed / drawAnimDurationMs, 1);
    drawLineCount = Math.floor(drawAnimProgress * fullLinkLines.length);
    updateCaption(drawAnimProgress);
    if (drawAnimProgress >= 1) finishDrawAnimation();
  }

  drawScene();
  requestAnimationFrame(animate);
}

// ═══════════════════════════════════════════════════════════════
// RENDER LOOP — theme-aware canvas painting
// ═══════════════════════════════════════════════════════════════

function drawScene(): void {
  const ct = CANVAS_THEMES[currentTheme];
  ctx.fillStyle = ct.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { x: cx, y: cy } = sunPos();

  // ── Sun (radial glow + solid core + breathing pulse) ─────────
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

  // ── Orbital link lines (progressive during draw animation) ───
  ctx.strokeStyle = ct.linkLine;
  ctx.lineWidth   = 1;
  const linesToDraw = drawAnimActive ? drawLineCount : linkLines.length;
  for (let i = 0; i < linesToDraw; i++) {
    const line = linkLines[i];
    ctx.beginPath();
    ctx.moveTo(line.p1.x, line.p1.y);
    ctx.lineTo(line.p2.x, line.p2.y);
    ctx.stroke();
  }

  // ── Shapes, their intersection dots, playheads, trigger rings ─
  for (const shape of shapes) {
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

  // ── Ambient dust particles ──────────────────────────────────
  updateAndDrawDust(16);  // ~16ms per frame at 60fps

  // ── LC signature monogram ──────────────────────────────────
  ctx.save();
  ctx.font = '500 10px "JetBrains Mono", monospace';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = currentTheme === 'dark'
    ? 'rgba(120, 88, 55, 0.35)'
    : 'rgba(92, 58, 33, 0.30)';
  ctx.fillText('LC', 16, canvas.height - 12);
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════════
// TELEMETRY PANEL  — <textarea> live-code editor
// ═══════════════════════════════════════════════════════════════

const telemetryTextarea = document.getElementById('telemetry-code') as HTMLTextAreaElement;
const telemetryPanel    = document.getElementById('telemetry-panel')!;
const telemetryTab      = document.getElementById('telemetry-tab') as HTMLButtonElement;
const evalStatusEl      = document.getElementById('eval-status')!;

/** Build the full executable Strudel code from all shapes (used on structural changes). */
function generateFullCode(): string {
  const header = [
    '// Solar System Sonification \u2014 Live Code',
    '// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
    `// Pattern: ${currentPattern.name}  |  Shapes: ${shapes.length}  |  Samples: ${SAMPLE_RATE}  |  CPM: ${CPM}`,
    '',
  ].join('\n');

  if (shapes.length === 0) {
    return header + '// Spawn shapes from the Sonic Foundry dock.';
  }
  return header + shapes.map(s => s.toStrudelCode()).join('\n\n');
}

// ── Surgical textarea patch functions ─────────────────────────
//
// These preserve user edits to pattern lines while updating only
// what the geometry engine owns (the rhythm string or full block).

function patchRhythm(shape: CanvasShape): void {
  const v      = `r_${shape.id}`;
  const marker = `// @rhythm-${shape.id}`;
  // Match backtick-delimited multi-line rhythm string ([\s\S]*? = any char incl. newlines)
  const regex   = new RegExp(`const ${v} = \`[\\s\\S]*?\`; ${marker}`);
  const newLine = `const ${v} = \`${shape.generateRhythmString()}\`; ${marker}`;
  const current = telemetryTextarea.value;
  const patched = current.replace(regex, newLine);
  if (patched !== current) telemetryTextarea.value = patched;
}

function patchShapeBlock(shape: CanvasShape): void {
  const start = `// @shape-start-${shape.id}`;
  const end   = `// @shape-end-${shape.id}`;
  const regex = new RegExp(`${start}[\\s\\S]*?${end}`);
  const current = telemetryTextarea.value;
  if (regex.test(current)) {
    telemetryTextarea.value = current.replace(regex, shape.toStrudelCode());
  } else {
    telemetryTextarea.value = generateFullCode();
  }
}

function patchHeader(): void {
  const newHeader = `// Pattern: ${currentPattern.name}  |  Shapes: ${shapes.length}  |  Samples: ${SAMPLE_RATE}  |  CPM: ${CPM}`;
  telemetryTextarea.value = telemetryTextarea.value.replace(
    /\/\/ Pattern: .+  \|  Shapes: \d+  \|  Samples: \d+  \|  CPM: \d+/,
    newHeader,
  );
}

function patchAllRhythms(): void {
  for (const s of shapes) patchRhythm(s);
  patchHeader();
}

/**
 * After linkLines change (sample rate / resize), re-emit Strudel blocks for
 * sweeper shapes so freq/gain values reflect the new orbital geometry.
 * Non-sweepers are handled surgically by patchAllRhythms().
 */
function rebuildSweeperPatterns(): void {
  let hasSweeper = false;
  for (const s of shapes) {
    if (s.type === 'sweeper') { patchShapeBlock(s); hasSweeper = true; }
  }
  if (hasSweeper && audioInitialized) playLiveCode(telemetryTextarea.value);
}

// ── Full regeneration (add/delete) ────────────────────────────

/**
 * Fully regenerate the textarea from current shape state.
 * Never auto-evaluates — press Ctrl+Enter or click Sync to run.
 */
function updateTelemetry(): void {
  telemetryTextarea.value = generateFullCode();
}

// ── Strudel evaluation (manual only via evaluateAndFlash) ─────

function playLiveCode(codeString: string): void {
  if (!strudelRepl) return;
  try {
    strudelRepl.evaluate(codeString).then(() => {
      setEvalStatus('ok');
    }).catch((err: unknown) => {
      console.warn('[strudel-eval async]', err);
      setEvalStatus('error');
    });
  } catch (error) {
    console.warn('[strudel-eval]', error);
    setEvalStatus('error');
  }
}

function setEvalStatus(status: 'ok' | 'error' | 'idle'): void {
  evalStatusEl.className = `eval-status ${status}`;
  evalStatusEl.textContent = status === 'ok' ? '\u2713 synced' : status === 'error' ? '\u2717 error' : '';
}

const _flashCooldowns = new Map<number, number>();
const FLASH_COOLDOWN_MS = 80;

function flashTelemBlock(shape: CanvasShape, now: number): void {
  const last = _flashCooldowns.get(shape.id) ?? 0;
  if (now - last < FLASH_COOLDOWN_MS) return;
  _flashCooldowns.set(shape.id, now);
  evalStatusEl.classList.remove('telem-flash');
  void evalStatusEl.offsetWidth;
  evalStatusEl.classList.add('telem-flash');
}

function toggleTelemetry(): void {
  const collapsed = telemetryPanel.classList.toggle('collapsed');
  telemetryTab.setAttribute('aria-expanded', String(!collapsed));
}
telemetryTab.addEventListener('click', toggleTelemetry);

// ═══════════════════════════════════════════════════════════════
// EVALUATE + GLOBAL FLASH
// The ONLY entry-points for audio evaluation: Ctrl+Enter or Sync btn.
// ═══════════════════════════════════════════════════════════════

/**
 * Evaluate the live code and flash whichever surface is currently visible:
 * - Panel open   → flash the textarea (code-flash), no global flash
 * - Panel collapsed → flash the main view (global-flash), no textarea flash
 *
 * This is the single place that calls playLiveCode().
 */
function evaluateAndFlash(): void {
  if (!audioInitialized) return;
  playLiveCode(telemetryTextarea.value);

  const panelOpen = !telemetryPanel.classList.contains('collapsed');
  if (panelOpen) {
    // Code panel visible — flash the textarea only
    telemetryTextarea.classList.add('code-flash');
    setTimeout(() => telemetryTextarea.classList.remove('code-flash'), 150);
  } else {
    // Code panel hidden — flash the main view instead
    document.body.classList.add('global-flash');
    setTimeout(() => document.body.classList.remove('global-flash'), 450);
  }
}

// ═══════════════════════════════════════════════════════════════
// STRUDEL AUDIO INITIALISATION  (called from overlay button)
// ═══════════════════════════════════════════════════════════════

async function initializeAudio(): Promise<void> {
  try {
    initAudioOnFirstClick();
    const ac = getAudioContext();
    if (ac.state === 'suspended') await ac.resume();

    await initAudio();
    registerSynthSounds();

    await evalScope(
      import('@strudel/core'),
      import('@strudel/webaudio'),
      import('@strudel/mini'),
    );

    const globalSamples = (globalThis as Record<string, unknown>)['samples'];
    if (typeof globalSamples === 'function') {
      (globalSamples as (url: string) => Promise<void>)(
        'github:tidalcycles/Dirt-Samples/main',
      ).catch(() => console.warn('[audio] Drum samples unavailable (offline?)'));

      // Acoustic bass — pitch-mapped MP3s from midi-js-soundfonts CDN.
      // Strudel interpolates pitch between these anchor notes automatically.
      const bassBase = 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_bass-mp3/';
      (globalSamples as (obj: Record<string, string[]>) => Promise<void>)({
        gm_acoustic_bass: ['A1','C2','E2','G2','A2','C3','E3','G3','A3','C4']
          .map(n => bassBase + n + '.mp3'),
      }).catch(() => console.warn('[audio] Bass samples unavailable (offline?)'));
    }

    strudelRepl = repl({
      defaultOutput: webaudioOutput,
      getTime: () => ac.currentTime,
      transpiler,
    });

    strudelRepl.setCps(CPM / 60);
    audioInitialized = true;

    document.getElementById('audio-overlay')!.classList.add('hidden');

    // Populate the textarea and pre-warm the Strudel compiler so the pattern
    // is ready before the user hits play (avoids first-play compile delay).
    updateTelemetry();
    playLiveCode(telemetryTextarea.value);

    // Show pattern selector for the user to choose a link-line pattern
    showPatternSelector();
  } catch (err) {
    console.error('[audio] init failed:', err);
  }
}

document.getElementById('start-engine-btn')!.addEventListener('click', () => {
  void initializeAudio();
});

/** Sync Strudel scheduler tempo to our UI CPM value. */
function syncStrudelCps(): void {
  if (strudelRepl !== null) {
    strudelRepl.setCps(CPM / 60);
  }
}

// ═══════════════════════════════════════════════════════════════
// SAMPLE RATE KNOB  (bidirectional: drag ↔ Cmd+Scroll)
// ═══════════════════════════════════════════════════════════════

const sampleKnobEl     = document.getElementById('sample-knob')!;
const knobNeedleGroup  = document.getElementById('knob-needle-group') as unknown as SVGGElement;
const knobValueEl      = document.getElementById('knob-value')!;

function updateSampleKnobVisual(): void {
  const pct   = (SAMPLE_RATE - MIN_SAMPLES) / (MAX_SAMPLES - MIN_SAMPLES);
  const angle = -135 + pct * 270;
  knobNeedleGroup.style.transform = `rotate(${angle}deg)`;
  knobValueEl.textContent = String(SAMPLE_RATE);
  sampleKnobEl.setAttribute('aria-valuenow', String(SAMPLE_RATE));
}

let knobDragging      = false;
let knobDragStartY    = 0;
let knobDragStartRate = SAMPLE_RATE;
const KNOB_SENSITIVITY = 5;

sampleKnobEl.addEventListener('mousedown', e => {
  knobDragging      = true;
  knobDragStartY    = e.clientY;
  knobDragStartRate = SAMPLE_RATE;
  e.preventDefault();
  e.stopPropagation();
});

sampleKnobEl.addEventListener('keydown', e => {
  let delta = 0;
  if (e.key === 'ArrowUp'   || e.key === 'ArrowRight') delta = +25;
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')  delta = -25;
  if (delta === 0) return;
  e.preventDefault();
  SAMPLE_RATE = clamp(SAMPLE_RATE + delta, MIN_SAMPLES, MAX_SAMPLES);
  calculateLines();
  updateSampleKnobVisual();
  patchAllRhythms();
  rebuildSweeperPatterns();
  // No auto-eval — press Ctrl+Enter to sync
});

// ═══════════════════════════════════════════════════════════════
// CPM KNOB  (bidirectional: drag ↔ future MIDI / tap-tempo)
// ═══════════════════════════════════════════════════════════════

const cpmKnobEl       = document.getElementById('cpm-knob')!;
const cpmNeedleGroup  = document.getElementById('cpm-needle-group') as unknown as SVGGElement;
const cpmValueEl      = document.getElementById('cpm-value')!;

function updateCpmKnobVisual(): void {
  const pct   = (CPM - MIN_CPM) / (MAX_CPM - MIN_CPM);
  const angle = -135 + pct * 270;
  cpmNeedleGroup.style.transform = `rotate(${angle}deg)`;
  cpmValueEl.textContent = String(CPM);
  cpmKnobEl.setAttribute('aria-valuenow', String(CPM));
}

let cpmDragging      = false;
let cpmDragStartY    = 0;
let cpmDragStartCPM  = CPM;
const CPM_SENSITIVITY = 2;

cpmKnobEl.addEventListener('mousedown', e => {
  cpmDragging     = true;
  cpmDragStartY   = e.clientY;
  cpmDragStartCPM = CPM;
  e.preventDefault();
  e.stopPropagation();
});

cpmKnobEl.addEventListener('keydown', e => {
  let delta = 0;
  if (e.key === 'ArrowUp'   || e.key === 'ArrowRight') delta = +5;
  if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')  delta = -5;
  if (delta === 0) return;
  e.preventDefault();
  // Re-anchor sweep phase at old CPM before changing tempo — prevents arm jump.
  if (isPlaying && audioInitialized) {
    const cycleS_old = 60 / CPM;
    sweepPhaseAtRef  = (sweepPhaseAtRef +
      (getAudioContext().currentTime - sweepAudioRefTime) / cycleS_old) % 1;
    sweepAudioRefTime = getAudioContext().currentTime;
  }
  CPM = clamp(CPM + delta, MIN_CPM, MAX_CPM);
  updateCpmKnobVisual();
  syncStrudelCps();
  patchHeader();
});

// ═══════════════════════════════════════════════════════════════
// PLAYBACK MODE TOGGLE
// ═══════════════════════════════════════════════════════════════

const modeToggle  = document.getElementById('mode-toggle')!;
const modeOptions = modeToggle.querySelectorAll<HTMLElement>('.mode-option');

function setPlaybackMode(mode: PlaybackMode): void {
  playbackMode = mode;
  modeOptions.forEach(opt =>
    opt.classList.toggle('active', opt.dataset['mode'] === mode),
  );
}

modeToggle.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('.mode-option');
  if (target?.dataset['mode']) {
    setPlaybackMode(target.dataset['mode'] as PlaybackMode);
  }
});

// ═══════════════════════════════════════════════════════════════
// PLAY / PAUSE BUTTON
// ═══════════════════════════════════════════════════════════════

const playPauseBtn = document.getElementById('play-pause-btn') as HTMLButtonElement;

function togglePlayback(): void {
  isPlaying = !isPlaying;
  playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
  playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Resume playback');
  playPauseBtn.classList.toggle('playing', isPlaying);

  if (isPlaying) {
    lastFrameTime = 0;
    if (strudelRepl !== null) {
      // Un-suspend the AudioContext (may have been suspended on pause)
      try { void getAudioContext().resume(); } catch (_) { /* not yet initialized */ }
      // Start the clock immediately — pattern was pre-warmed on spawn/init,
      // so audio begins with minimal delay.  Evaluate runs in parallel to keep
      // the compiled pattern up-to-date for any changes made while paused.
      strudelRepl.start();
      // Anchor sweeper arm to this exact audio moment.
      // sweepPhaseAtRef is preserved from the last pause so the arm resumes
      // from the same position without jumping.
      try { sweepAudioRefTime = getAudioContext().currentTime; } catch (_) {}
      strudelRepl.evaluate(telemetryTextarea.value)
        .then(() => setEvalStatus('ok'))
        .catch((err: unknown) => { console.warn('[strudel-eval async]', err); setEvalStatus('error'); });
    }
  } else {
    // Accumulate phase before stopping so the arm resumes from the right position.
    try {
      const cycleS = 60 / CPM;
      sweepPhaseAtRef = (sweepPhaseAtRef +
        (getAudioContext().currentTime - sweepAudioRefTime) / cycleS) % 1;
    } catch (_) { /* audio not yet initialized */ }
    if (strudelRepl !== null) strudelRepl.stop();
    // Suspend the AudioContext to kill any oscillators still running in the
    // lookahead buffer — this is the only reliable way to stop them instantly.
    try { void getAudioContext().suspend(); } catch (_) { /* not yet initialized */ }
  }
}

playPauseBtn.addEventListener('click', togglePlayback);

// ═══════════════════════════════════════════════════════════════
// GLOBAL MOUSEMOVE + MOUSEUP  (three concurrent drag operations)
// ═══════════════════════════════════════════════════════════════

let shapeDragTarget: CanvasShape | null = null;
let shapeDragOffset = { x: 0, y: 0 };
let didDragShape    = false;
let mouseDownPos    = { x: 0, y: 0 };
const DRAG_THRESHOLD = 5;

canvas.addEventListener('mousedown', e => {
  mouseDownPos = { x: e.clientX, y: e.clientY };
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (shapes[i].containsPoint(e.clientX, e.clientY)) {
      shapeDragTarget   = shapes[i];
      shapeDragOffset.x = shapes[i].x - e.clientX;
      shapeDragOffset.y = shapes[i].y - e.clientY;
      break;
    }
  }
});

window.addEventListener('mousemove', e => {
  // ── Sample rate knob ─────────────────────────────────────────
  if (knobDragging) {
    const dy    = knobDragStartY - e.clientY;
    SAMPLE_RATE = clamp(knobDragStartRate + Math.round(dy * KNOB_SENSITIVITY), MIN_SAMPLES, MAX_SAMPLES);
    calculateLines();
    updateSampleKnobVisual();
    patchAllRhythms();
    rebuildSweeperPatterns();
    // No auto-eval — press Ctrl+Enter to sync
    return;
  }

  // ── CPM knob ─────────────────────────────────────────────────
  if (cpmDragging) {
    const dy     = cpmDragStartY - e.clientY;
    const newCPM = clamp(cpmDragStartCPM + Math.round(dy * CPM_SENSITIVITY), MIN_CPM, MAX_CPM);
    // Re-anchor sweep phase at old CPM before changing tempo — prevents arm jump.
    if (newCPM !== CPM && isPlaying && audioInitialized) {
      const cycleS_old = 60 / CPM;
      sweepPhaseAtRef  = (sweepPhaseAtRef +
        (getAudioContext().currentTime - sweepAudioRefTime) / cycleS_old) % 1;
      sweepAudioRefTime = getAudioContext().currentTime;
    }
    CPM = newCPM;
    updateCpmKnobVisual();
    syncStrudelCps();
    patchHeader();
    return;
  }

  // ── Shape drag ────────────────────────────────────────────────
  if (shapeDragTarget === null) return;
  if (Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y) < DRAG_THRESHOLD) return;

  didDragShape        = true;
  shapeDragTarget.x   = e.clientX + shapeDragOffset.x;
  shapeDragTarget.y   = e.clientY + shapeDragOffset.y;
  shapeDragTarget.rebuildIntersectionCache(linkLines);
});

window.addEventListener('mouseup', () => {
  knobDragging    = false;
  cpmDragging     = false;
  shapeDragTarget = null;
});

// ═══════════════════════════════════════════════════════════════
// CANVAS CLICK  (select / deselect shapes, toggle sound menu)
// ═══════════════════════════════════════════════════════════════

canvas.addEventListener('click', e => {
  if (didDragShape) {
    didDragShape = false;
    patchAllRhythms();
    // No auto-eval — press Ctrl+Enter to sync
    return;
  }

  let hit: CanvasShape | null = null;
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (shapes[i].containsPoint(e.clientX, e.clientY)) { hit = shapes[i]; break; }
  }

  if (hit !== null) {
    const wasActive = hit === activeShape;
    setActiveShape(wasActive ? null : hit);
    if (!wasActive) showSoundMenu(hit);
    else hideSoundMenu();
  } else {
    setActiveShape(null);
    hideSoundMenu();
  }
});

// ═══════════════════════════════════════════════════════════════
// WHEEL  — shape resize (plain scroll) | SAMPLE_RATE (Cmd/Ctrl+scroll)
// Fine-grained step (+2/-2) for precise shape sizing.
// ═══════════════════════════════════════════════════════════════

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const up = e.deltaY < 0;

  if (e.metaKey || e.ctrlKey) {
    SAMPLE_RATE = clamp(SAMPLE_RATE + (up ? +25 : -25), MIN_SAMPLES, MAX_SAMPLES);
    calculateLines();
    updateSampleKnobVisual();
    patchAllRhythms();
    rebuildSweeperPatterns();
    // No auto-eval
  } else if (activeShape !== null) {
    if (activeShape.type === 'sweeper') {
      // Nudge 12 o'clock by 1° per scroll click; arm keeps rotating uninterrupted
      const step  = Math.PI / 180;
      const delta = up ? -step : step;
      activeShape.startAngle = ((activeShape.startAngle + delta) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      activeShape.rebuildSweepTicks(linkLines, ORBITAL_MAX_RADIUS);
      drawScene();  // instant repaint — don't wait for next rAF frame
      updateTelemetry();
      if (audioInitialized) playLiveCode(telemetryTextarea.value);
    } else {
      // Fine-grained step: +2/-2 px for precise control
      activeShape.size = clamp(activeShape.size + (up ? +2 : -2), MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
      activeShape.rebuildIntersectionCache(linkLines);
      patchRhythm(activeShape);
      patchHeader();
      // No auto-eval
    }
  }
}, { passive: false });

// ═══════════════════════════════════════════════════════════════
// DOCK — click-to-spawn
// ═══════════════════════════════════════════════════════════════

document.querySelectorAll<HTMLButtonElement>('.shape-tile').forEach(tile => {
  tile.addEventListener('click', () => {
    spawnShape((tile.dataset['shape'] ?? 'circle') as ShapeType);
  });
});

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT SELECTION PANEL
// ═══════════════════════════════════════════════════════════════

const soundMenu       = document.getElementById('sound-menu')!;
const instrumentBtns  = soundMenu.querySelectorAll<HTMLButtonElement>('[data-instrument]');

function showSoundMenu(shape: CanvasShape): void {
  instrumentBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset['instrument'] === shape.instrument),
  );

  // Show/hide sweeper-specific controls and sync sliders
  const sweeperControls = soundMenu.querySelector('#sweeper-controls');
  if (sweeperControls) {
    if (shape.type === 'sweeper') {
      sweeperControls.classList.remove('hidden');
      const kSliderEl = soundMenu.querySelector('#sweeper-k-slider') as HTMLInputElement;
      const kValueEl  = soundMenu.querySelector('#sweeper-k-value');
      if (kSliderEl && kValueEl) {
        kSliderEl.value      = shape.k.toString();
        kValueEl.textContent = shape.k.toString();
      }
      const armsSliderEl = soundMenu.querySelector('#sweeper-arms-slider') as HTMLInputElement;
      const armsValueEl  = soundMenu.querySelector('#sweeper-arms-value');
      if (armsSliderEl && armsValueEl) {
        armsSliderEl.value      = shape.sweepCount.toString();
        armsValueEl.textContent = shape.sweepCount.toString();
      }
      const posSliderEl = soundMenu.querySelector('#sweeper-pos-slider') as HTMLInputElement;
      const posValueEl  = soundMenu.querySelector('#sweeper-pos-value');
      if (posSliderEl && posValueEl) {
        posSliderEl.value      = shape.ticks.toString();
        posValueEl.textContent = shape.ticks.toString();
      }
    } else {
      sweeperControls.classList.add('hidden');
    }
  }


  soundMenu.classList.remove('hidden');
}

function hideSoundMenu(): void {
  soundMenu.classList.add('hidden');
}

instrumentBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (activeShape === null) return;
    const instr = btn.dataset['instrument']!;
    activeShape.instrument = instr;

    instrumentBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    patchShapeBlock(activeShape);
    patchHeader();
    // No auto-eval — press Ctrl+Enter to sync
  });
});

// K-slider: control top-K cluster count for sweepers
const kSlider = document.getElementById('sweeper-k-slider') as HTMLInputElement;
const kValue = document.getElementById('sweeper-k-value');
if (kSlider && kValue) {
  kSlider.addEventListener('input', () => {
    const k = parseInt(kSlider.value, 10);
    kValue.textContent = k.toString();
    if (activeShape?.type === 'sweeper') {
      activeShape.k = k;
      activeShape.rebuildSweepTicks(linkLines, ORBITAL_MAX_RADIUS);
      updateTelemetry();
      if (audioInitialized) playLiveCode(telemetryTextarea.value);
    }
  });
}

const armsSlider = document.getElementById('sweeper-arms-slider') as HTMLInputElement;
const armsValue  = document.getElementById('sweeper-arms-value');
if (armsSlider && armsValue) {
  armsSlider.addEventListener('input', () => {
    const arms = parseInt(armsSlider.value, 10);
    armsValue.textContent = arms.toString();
    if (activeShape?.type === 'sweeper') {
      activeShape.sweepCount = arms;
      activeShape.rebuildSweepTicks(linkLines, ORBITAL_MAX_RADIUS);
      updateTelemetry();
      if (audioInitialized) playLiveCode(telemetryTextarea.value);
    }
  });
}

// Positions slider: control tick count per revolution for sweepers
const posSlider = document.getElementById('sweeper-pos-slider') as HTMLInputElement;
const posValue  = document.getElementById('sweeper-pos-value');
if (posSlider && posValue) {
  posSlider.addEventListener('input', () => {
    const ticks = parseInt(posSlider.value, 10);
    posValue.textContent = ticks.toString();
    if (activeShape?.type === 'sweeper') {
      activeShape.ticks = ticks;
      activeShape.rebuildSweepTicks(linkLines, ORBITAL_MAX_RADIUS);
      updateTelemetry();
      if (audioInitialized) playLiveCode(telemetryTextarea.value);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// SYNC AUDIO BUTTON  (#sync-audio-btn in telemetry footer)
// ═══════════════════════════════════════════════════════════════

document.getElementById('sync-audio-btn')!.addEventListener('click', () => {
  evaluateAndFlash();
});

// ═══════════════════════════════════════════════════════════════
// THEME TOGGLE  (#theme-toggle near CPM knob)
// ═══════════════════════════════════════════════════════════════

const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement;

function setTheme(theme: AppTheme): void {
  currentTheme = theme;
  document.documentElement.dataset['theme'] = theme === 'light' ? 'light' : '';
  themeToggleBtn.textContent = theme === 'light' ? '◑' : '☀';
  themeToggleBtn.setAttribute(
    'aria-label',
    theme === 'light' ? 'Switch to Martian Dusk' : 'Switch to Daylight',
  );
  themeToggleBtn.title = theme === 'light' ? 'Martian Dusk theme' : 'Daylight theme';
}

themeToggleBtn.addEventListener('click', () => {
  setTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// ═══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
//   Ctrl/Cmd+Enter → evaluate & flash (global, works from textarea too)
//   D              → toggle dock + UI panels
//   I              → toggle telemetry panel
//   Space          → play / pause  (skip animation if drawing)
//   P              → open pattern selector
//   Backspace      → delete active shape
// ═══════════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  // Ctrl/Cmd+Enter: intercept globally before any input guard
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    evaluateAndFlash();
    return;
  }

  // All other shortcuts — skip when focus is in a text input
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  switch (e.key.toLowerCase()) {
    case 'd':
      document.body.classList.toggle('ui-hidden');
      break;
    case 'i':
      toggleTelemetry();
      break;
    case ' ':
      e.preventDefault();
      if (drawAnimActive) {
        finishDrawAnimation();
      } else {
        togglePlayback();
      }
      break;
    case 'p':
      if (!drawAnimActive && audioInitialized) {
        showPatternSelector();
      }
      break;
    case 'backspace':
      e.preventDefault();
      deleteActiveShape();
      break;
  }
});

// ═══════════════════════════════════════════════════════════════
// INITIALISE
// ═══════════════════════════════════════════════════════════════

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
calculateLines();
updateSampleKnobVisual();
updateCpmKnobVisual();
updateTelemetry();
setTheme('light');   // initialise button label + dataset attribute

// Sync play/pause button to match initial isPlaying state
playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Resume playback');
playPauseBtn.classList.toggle('playing', isPlaying);

requestAnimationFrame(animate);
