// src/main.ts
import './style.css';
import type { Point } from './geometry';
import { CanvasShape, type ShapeType, type SoundCategory, type PlaybackMode } from './shapes';
import { evalScope } from '@strudel/core';
import { webaudioRepl, initAudio, getAudioContext, type StrudelRepl } from '@strudel/webaudio';

// ═══════════════════════════════════════════════════════════════
// CANVAS SETUP
// ═══════════════════════════════════════════════════════════════

const canvas = document.getElementById('simCanvas') as HTMLCanvasElement;
const ctx    = canvas.getContext('2d')!;

function resize(): void {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  calculateLines();  // recalculate + rebuild caches (centre shifts on resize)
  drawScene();
}
window.addEventListener('resize', resize);

// ═══════════════════════════════════════════════════════════════
// ORBITAL ENGINE  (pre-calculated geometry)
// ═══════════════════════════════════════════════════════════════

const AU_SCALE     = 300;
const EARTH_R      = 1.0   * AU_SCALE;
const VENUS_R      = 0.723 * AU_SCALE;
const EARTH_PERIOD = 365.25;
const VENUS_PERIOD = 224.7;
const SIM_YEARS    = 8;

let SAMPLE_RATE   = 500;
const MIN_SAMPLES = 10;
const MAX_SAMPLES = 2000;

let linkLines: { p1: Point; p2: Point }[] = [];

function calculateLines(): void {
  linkLines = [];
  const cx        = canvas.width  / 2;
  const cy        = canvas.height / 2;
  const totalDays = SIM_YEARS * EARTH_PERIOD;

  for (let i = 0; i < SAMPLE_RATE; i++) {
    const t  = (i / SAMPLE_RATE) * totalDays;
    const ea = (t / EARTH_PERIOD) * 2 * Math.PI;
    const va = (t / VENUS_PERIOD) * 2 * Math.PI;
    linkLines.push({
      p1: { x: cx + EARTH_R * Math.cos(ea), y: cy + EARTH_R * Math.sin(ea) },
      p2: { x: cx + VENUS_R * Math.cos(va), y: cy + VENUS_R * Math.sin(va) },
    });
  }

  // Intersection caches are keyed to linkLines — always rebuild together
  rebuildAllCaches();
}

// ═══════════════════════════════════════════════════════════════
// SHAPE STATE
// ═══════════════════════════════════════════════════════════════

const shapes: CanvasShape[]         = [];
let   activeShape: CanvasShape | null = null;

const MIN_SHAPE_SIZE = 20;
const MAX_SHAPE_SIZE = 400;

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const sunPos = (): { x: number; y: number } => ({
  x: canvas.width  / 2,
  y: canvas.height / 2,
});

/** Rebuild all shapes' intersection caches (call after linkLines change). */
function rebuildAllCaches(): void {
  for (const s of shapes) s.rebuildIntersectionCache(linkLines);
}

function spawnShape(type: ShapeType): void {
  const { x, y } = sunPos();
  const s = new CanvasShape(x, y, type);
  shapes.push(s);
  s.rebuildIntersectionCache(linkLines);
  setActiveShape(s);
  hideSoundMenu();
  updateTelemetry();
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
  updateTelemetry();
}

// ═══════════════════════════════════════════════════════════════
// SEQUENCER STATE
// ═══════════════════════════════════════════════════════════════

let CPM: number          = 60;
const MIN_CPM            = 10;
const MAX_CPM            = 120;
let playbackMode: PlaybackMode = 'constant-time';
let isPlaying            = true;
let lastFrameTime        = 0;    // 0 = not yet started

// ═══════════════════════════════════════════════════════════════
// STRUDEL AUDIO STATE
// ═══════════════════════════════════════════════════════════════

let strudelRepl: StrudelRepl | null = null;
let audioInitialized = false;

/**
 * Tiny passthrough transpiler — makes the repl wrap our code inside
 * (async () => { CODE })() so multi-statement blocks work.
 * Patterns self-register via .p("sN"); no explicit return needed.
 */
function simpleTranspiler(code: string): { output: string } {
  return { output: code };
}

// ═══════════════════════════════════════════════════════════════
// CONTINUOUS ANIMATION LOOP  (performance.now() via rAF)
// ═══════════════════════════════════════════════════════════════

function animate(now: number): void {
  // Compute dt; cap at 100ms to absorb tab-switch / background-throttle gaps
  let dt = 0;
  if (isPlaying && lastFrameTime > 0) {
    dt = Math.min(now - lastFrameTime, 100);
  }
  lastFrameTime = now;

  if (isPlaying && dt > 0) {
    for (const shape of shapes) {
      shape.stepPlayhead(dt, CPM, playbackMode);

      const triggered = shape.checkAndFireCollisions();
      if (triggered.length > 0) {
        for (const int of triggered) shape.triggerAt(int.x, int.y);
        flashTelemBlock(shape, now);
      }

      shape.stepAnimations();
    }
  }

  drawScene();
  requestAnimationFrame(animate);
}

// ═══════════════════════════════════════════════════════════════
// RENDER LOOP — Martian Dusk palette
// ═══════════════════════════════════════════════════════════════

function drawScene(): void {
  ctx.fillStyle = '#120F0E';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { x: cx, y: cy } = sunPos();

  // ── Sun (radial glow + solid core) ───────────────────────────
  const sunGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 34);
  sunGlow.addColorStop(0,   'rgba(255, 170, 60, 0.85)');
  sunGlow.addColorStop(0.5, 'rgba(230, 100, 30, 0.35)');
  sunGlow.addColorStop(1,   'rgba(180,  60, 10, 0)');
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.fillStyle = sunGlow;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#FFA030';
  ctx.fill();

  // ── Orbital link lines (copper) ───────────────────────────────
  ctx.strokeStyle = 'rgba(194, 118, 46, 0.32)';
  ctx.lineWidth   = 1;
  for (const line of linkLines) {
    ctx.beginPath();
    ctx.moveTo(line.p1.x, line.p1.y);
    ctx.lineTo(line.p2.x, line.p2.y);
    ctx.stroke();
  }

  // ── Shapes, their intersection dots, playheads, trigger rings ─
  for (const shape of shapes) {
    // Shape outline
    shape.draw(ctx);

    // Intersection dots (use cached points — avoids re-computation per frame)
    const dotColor = shape.accentColor;
    for (const int of shape.cachedIntersections) {
      ctx.beginPath();
      ctx.arc(int.x, int.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();
    }

    // Expanding-ring trigger animations (behind playhead)
    shape.drawAnimations(ctx);

    // Playhead dot (always visible, even when paused — shows position)
    shape.drawPlayhead(ctx);
  }
}

// ═══════════════════════════════════════════════════════════════
// TELEMETRY PANEL  — <textarea> live-code editor
// ═══════════════════════════════════════════════════════════════

const telemetryTextarea = document.getElementById('telemetry-code') as HTMLTextAreaElement;
const telemetryPanel    = document.getElementById('telemetry-panel')!;
const telemetryTab      = document.getElementById('telemetry-tab') as HTMLButtonElement;
const evalStatusEl      = document.getElementById('eval-status')!;

/** Build the full executable Strudel code from all shapes. */
function generateFullCode(): string {
  const header = [
    '// Solar System Sonification \u2014 Live Code',
    '// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
    `// Shapes: ${shapes.length}  |  Samples: ${SAMPLE_RATE}  |  CPM: ${CPM}`,
    '',
  ].join('\n');

  if (shapes.length === 0) {
    return header + '// Spawn shapes from the Sonic Foundry dock.';
  }

  const shapeCodes = shapes.map(s => s.toStrudelCode()).join('\n\n');
  // Wire all stacked patterns to audio output via all()
  return shapeCodes + '\n\n// — Play all stacked patterns\nall(x => x.play())';
}

/**
 * Refresh the textarea contents.
 * @param shouldEval  When true, also debounce-trigger a Strudel re-evaluation.
 *                    Pass false for changes that only affect the header (e.g. CPM).
 */
function updateTelemetry(shouldEval = true): void {
  telemetryTextarea.value = generateFullCode();
  if (shouldEval && audioInitialized) {
    triggerEvaluation();
  }
}

// ── Debounced Strudel evaluation ──────────────────────────────

let _evalTimer: ReturnType<typeof setTimeout> | null = null;
const EVAL_DEBOUNCE_MS = 300;

function triggerEvaluation(): void {
  if (!audioInitialized || strudelRepl === null) return;
  if (_evalTimer !== null) clearTimeout(_evalTimer);
  _evalTimer = setTimeout(() => {
    void evaluateStrudelCode(telemetryTextarea.value);
  }, EVAL_DEBOUNCE_MS);
}

async function evaluateStrudelCode(code: string): Promise<void> {
  if (strudelRepl === null) return;
  try {
    await strudelRepl.evaluate(code);
    setEvalStatus('ok');
  } catch (err) {
    console.warn('[strudel-eval]', err);
    setEvalStatus('error');
  }
}

function setEvalStatus(status: 'ok' | 'error' | 'idle'): void {
  evalStatusEl.className = `eval-status ${status}`;
  evalStatusEl.textContent = status === 'ok' ? '\u2713 synced' : status === 'error' ? '\u2717 error' : '';
}

/**
 * Flash the eval-status to show a visual trigger beat (debounced).
 */
const _flashCooldowns = new Map<number, number>();
const FLASH_COOLDOWN_MS = 80;

function flashTelemBlock(shape: CanvasShape, now: number): void {
  const last = _flashCooldowns.get(shape.id) ?? 0;
  if (now - last < FLASH_COOLDOWN_MS) return;
  _flashCooldowns.set(shape.id, now);
  // Flash the eval status indicator briefly
  evalStatusEl.classList.remove('telem-flash');
  void evalStatusEl.offsetWidth;
  evalStatusEl.classList.add('telem-flash');
}

// ── Ctrl+Enter manual evaluation from textarea ───────────────

telemetryTextarea.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    void evaluateStrudelCode(telemetryTextarea.value);
  }
});

function toggleTelemetry(): void {
  const collapsed = telemetryPanel.classList.toggle('collapsed');
  telemetryTab.setAttribute('aria-expanded', String(!collapsed));
}
telemetryTab.addEventListener('click', toggleTelemetry);

// ═══════════════════════════════════════════════════════════════
// STRUDEL AUDIO INITIALISATION  (called from overlay button)
// ═══════════════════════════════════════════════════════════════

async function initializeAudio(): Promise<void> {
  try {
    const ac = getAudioContext();
    if (ac.state === 'suspended') await ac.resume();
    await initAudio();
    await evalScope(
      import('@strudel/core'),
      import('@strudel/webaudio'),
    );
    strudelRepl = webaudioRepl({ transpiler: simpleTranspiler });
    strudelRepl.setCps(CPM / 60);
    audioInitialized = true;

    document.getElementById('audio-overlay')!.classList.add('hidden');

    // Kick off the first evaluation with whatever code is currently generated
    updateTelemetry(true);
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
  updateTelemetry();
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
const CPM_SENSITIVITY = 2; // CPM units per pixel of vertical drag

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
  CPM = clamp(CPM + delta, MIN_CPM, MAX_CPM);
  updateCpmKnobVisual();
  syncStrudelCps();
  updateTelemetry(false);  // CPM only → no re-eval, just update header
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
  // Reset lastFrameTime so the first resumed frame has dt≈0 (no jump)
  if (isPlaying) lastFrameTime = 0;
  playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
  playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Resume playback');
  playPauseBtn.classList.toggle('playing', isPlaying);
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
    updateTelemetry();
    return;
  }

  // ── CPM knob ─────────────────────────────────────────────────
  if (cpmDragging) {
    const dy = cpmDragStartY - e.clientY;
    CPM = clamp(cpmDragStartCPM + Math.round(dy * CPM_SENSITIVITY), MIN_CPM, MAX_CPM);
    updateCpmKnobVisual();
    syncStrudelCps();
    updateTelemetry(false);  // CPM only → no re-eval
    return;
  }

  // ── Shape drag ────────────────────────────────────────────────
  if (shapeDragTarget === null) return;
  if (Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y) < DRAG_THRESHOLD) return;

  didDragShape        = true;
  shapeDragTarget.x   = e.clientX + shapeDragOffset.x;
  shapeDragTarget.y   = e.clientY + shapeDragOffset.y;
  // Rebuild cache in real-time so playhead collision stays accurate during drag
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
    updateTelemetry();
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

  updateTelemetry();
});

// ═══════════════════════════════════════════════════════════════
// WHEEL  — shape resize (plain scroll) | SAMPLE_RATE (Cmd/Ctrl+scroll)
// ═══════════════════════════════════════════════════════════════

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const up = e.deltaY < 0;

  if (e.metaKey || e.ctrlKey) {
    SAMPLE_RATE = clamp(SAMPLE_RATE + (up ? +25 : -25), MIN_SAMPLES, MAX_SAMPLES);
    calculateLines();
    updateSampleKnobVisual();
    updateTelemetry();
  } else if (activeShape !== null) {
    activeShape.size = clamp(activeShape.size + (up ? +8 : -8), MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
    activeShape.rebuildIntersectionCache(linkLines);
    updateTelemetry();
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
// SOUND CATEGORY PILL MENU
// ═══════════════════════════════════════════════════════════════

const soundMenu      = document.getElementById('sound-menu')!;
const categoryPills  = soundMenu.querySelectorAll<HTMLButtonElement>('.sound-pill:not(.template-pill)');
const templatePills  = soundMenu.querySelectorAll<HTMLButtonElement>('.template-pill');

function showSoundMenu(shape: CanvasShape): void {
  categoryPills.forEach(p =>
    p.classList.toggle('active', p.dataset['category'] === shape.soundProfile.category),
  );
  templatePills.forEach(p =>
    p.classList.toggle('active', Number(p.dataset['template']) === shape.templateIndex),
  );
  soundMenu.style.left = `${shape.x}px`;
  soundMenu.style.top  = `${shape.y - shape.size - 46}px`;
  soundMenu.classList.remove('hidden');
}

function hideSoundMenu(): void {
  soundMenu.classList.add('hidden');
}

categoryPills.forEach(pill => {
  pill.addEventListener('click', () => {
    if (activeShape === null) return;
    activeShape.soundProfile.category = pill.dataset['category'] as SoundCategory;
    categoryPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    updateTelemetry();
  });
});

templatePills.forEach(pill => {
  pill.addEventListener('click', () => {
    if (activeShape === null) return;
    activeShape.templateIndex = Number(pill.dataset['template']);
    templatePills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    updateTelemetry();
  });
});

// ═══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
//   D     → toggle dock + UI panels
//   I     → toggle telemetry panel
//   T     → cycle active shape's template
//   Space → play / pause
//   Bksp  → delete active shape
// ═══════════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  switch (e.key.toLowerCase()) {
    case 'd':
      document.body.classList.toggle('ui-hidden');
      break;
    case 'i':
      toggleTelemetry();
      break;
    case 't':
      if (activeShape !== null) {
        activeShape.templateIndex = (activeShape.templateIndex + 1) % 2;
        updateTelemetry();
      }
      break;
    case ' ':
      e.preventDefault();
      togglePlayback();
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
calculateLines();          // also calls rebuildAllCaches() (no shapes yet, so noop)
updateSampleKnobVisual();
updateCpmKnobVisual();
updateTelemetry();

// Kick off the continuous animation loop
requestAnimationFrame(animate);
