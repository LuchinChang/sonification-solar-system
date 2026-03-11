// src/main.ts
import './style.css';
import type { Point } from './geometry';
import { CanvasShape, type ShapeType, type PlaybackMode } from './shapes';
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
  calculateLines();
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

// Orbital bounds: furthest point from Sun (used for sweeper line length normalization)
const ORBITAL_MAX_RADIUS = Math.max(EARTH_R, VENUS_R) * 1.05;  // ~315 px

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

function rebuildAllCaches(): void {
  for (const s of shapes) s.rebuildIntersectionCache(linkLines);
}

function spawnShape(type: ShapeType): void {
  const { x, y } = sunPos();
  // Sweepers extend to MAX_SHAPE_SIZE; other shapes use the constructor default
  const size = type === 'sweeper' ? MAX_SHAPE_SIZE : undefined;
  const s = new CanvasShape(x, y, type, size);
  shapes.push(s);
  s.rebuildIntersectionCache(linkLines);
  setActiveShape(s);
  hideSoundMenu();
  updateTelemetry(true);  // full regen — shape list changed
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
  updateTelemetry(true);  // full regen — shape list changed
}

// ═══════════════════════════════════════════════════════════════
// SEQUENCER STATE
// ═══════════════════════════════════════════════════════════════

let CPM: number          = 60;
const MIN_CPM            = 10;
const MAX_CPM            = 120;
let playbackMode: PlaybackMode = 'constant-time';
let isPlaying            = true;
let lastFrameTime        = 0;

// ═══════════════════════════════════════════════════════════════
// STRUDEL AUDIO STATE
// ═══════════════════════════════════════════════════════════════

let strudelRepl: any = null;
let audioInitialized = false;

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
      shape.stepPlayhead(dt, CPM, playbackMode);

      if (shape.type === 'sweeper') {
        // Sweeper: recompute clusters from current angle and publish to globalThis
        // so that signal() callbacks in the Strudel pattern read fresh values.
        shape.computeSweepClusters(linkLines, ORBITAL_MAX_RADIUS);
        const g = globalThis as Record<string, number>;
        for (let i = 0; i < shape.k; i++) {
          const c = shape.sweepClusters[i];
          g[`__sw_${shape.id}_f${i}`] = c ? c.freq : 0;
          g[`__sw_${shape.id}_g${i}`] = c ? c.gain : 0;
        }
      } else {
        const triggered = shape.checkAndFireCollisions();
        if (triggered.length > 0) {
          for (const int of triggered) shape.triggerAt(int.x, int.y);
          flashTelemBlock(shape, now);
        }
        shape.stepAnimations();
      }
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
    `// Shapes: ${shapes.length}  |  Samples: ${SAMPLE_RATE}  |  CPM: ${CPM}`,
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

/**
 * Patch ONLY the `const r_N = "...";` line in the textarea.
 * Used when shape resizes, moves, or sample rate changes.
 * User edits to the pattern line below are untouched.
 */
function patchRhythm(shape: CanvasShape): void {
  const v      = `r_${shape.id}`;
  const marker = `// @rhythm-${shape.id}`;
  // [^"]* safely matches rhythm content; rhythm strings never contain quotes
  const regex  = new RegExp(`const ${v} = "[^"]*"; ${marker}`);
  const newLine = `const ${v} = "${shape.generateRhythmString()}"; ${marker}`;
  const current = telemetryTextarea.value;
  const patched = current.replace(regex, newLine);
  if (patched !== current) telemetryTextarea.value = patched;
}

/**
 * Replace the entire code block for one shape (between its @shape-start/end
 * markers).  Used when the instrument changes — the pattern template changes
 * completely, so preserving the old pattern line would produce wrong output.
 * Other shapes' code and any user edits outside this block are preserved.
 */
function patchShapeBlock(shape: CanvasShape): void {
  const start = `// @shape-start-${shape.id}`;
  const end   = `// @shape-end-${shape.id}`;
  // [\s\S]*? = any characters including newlines, non-greedy
  const regex = new RegExp(`${start}[\\s\\S]*?${end}`);
  const current = telemetryTextarea.value;
  if (regex.test(current)) {
    telemetryTextarea.value = current.replace(regex, shape.toStrudelCode());
  } else {
    // Block not found (e.g. textarea was fully cleared) — fall back to full regen
    telemetryTextarea.value = generateFullCode();
  }
}

/**
 * Update only the header comment line with current counts.
 * Used when CPM, SAMPLE_RATE, or shape count changes but we don't
 * want to re-evaluate the Strudel engine.
 */
function patchHeader(): void {
  const newHeader = `// Shapes: ${shapes.length}  |  Samples: ${SAMPLE_RATE}  |  CPM: ${CPM}`;
  telemetryTextarea.value = telemetryTextarea.value.replace(
    /\/\/ Shapes: \d+  \|  Samples: \d+  \|  CPM: \d+/,
    newHeader,
  );
}

/**
 * Patch all shapes' rhythm lines and update the header comment.
 * Call after SAMPLE_RATE changes or after a shape drag ends.
 */
function patchAllRhythms(): void {
  for (const s of shapes) patchRhythm(s);
  patchHeader();
}

// ── Full regeneration (add/delete) ────────────────────────────

/**
 * Fully regenerate the textarea.  Used when the shape list changes
 * (add/delete) so the block structure itself changes.
 * @param shouldEval  When true, also debounce-trigger a Strudel re-evaluation.
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
    playLiveCode(telemetryTextarea.value);
  }, EVAL_DEBOUNCE_MS);
}

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

// ── Ctrl+Enter manual evaluation from textarea ───────────────

telemetryTextarea.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    playLiveCode(telemetryTextarea.value);
    // Green flash: instant onset (transition: none on .code-flash),
    // smooth fade-out when the class is removed 150ms later.
    telemetryTextarea.classList.add('code-flash');
    setTimeout(() => telemetryTextarea.classList.remove('code-flash'), 150);
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
    initAudioOnFirstClick();
    const ac = getAudioContext();
    if (ac.state === 'suspended') await ac.resume();

    // initAudio boots the superdough WebAudio engine (worklet, routing, etc.).
    // registerSynthSounds adds oscillator synths (square, sawtooth, sine,
    // triangle, fm, supersaw…) into superdough's sound registry.
    await initAudio();
    registerSynthSounds();

    // Register all Strudel globals onto globalThis (s, note, silence,
    // struct, m, samples, etc.) so eval'd code can access them.
    await evalScope(
      import('@strudel/core'),
      import('@strudel/webaudio'),
      import('@strudel/mini'),
    );

    // Best-effort: load the Tidal Dirt-Samples pack so that drum sounds
    // (bd, sd, hh, cp) resolve at runtime.  Loads lazily from GitHub;
    // browser caches after first use.  Synth sounds work without this.
    const globalSamples = (globalThis as Record<string, unknown>)['samples'];
    if (typeof globalSamples === 'function') {
      (globalSamples as (url: string) => Promise<void>)(
        'github:tidalcycles/Dirt-Samples/main',
      ).catch(() => console.warn('[audio] Drum samples unavailable (offline?)'));
    }

    // Create the REPL with the transpiler wired in.
    // repl.evaluate() transpiles mini-notation, evals, and starts the
    // scheduler automatically — no manual scheduler.start() needed.
    strudelRepl = repl({
      defaultOutput: webaudioOutput,
      getTime: () => ac.currentTime,
      transpiler,
    });

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
  patchAllRhythms();
  if (audioInitialized) triggerEvaluation();
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
  CPM = clamp(CPM + delta, MIN_CPM, MAX_CPM);
  updateCpmKnobVisual();
  syncStrudelCps();
  patchHeader();  // just update the header comment, no re-eval needed
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
  if (isPlaying) lastFrameTime = 0;
  playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
  playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause playback' : 'Resume playback');
  playPauseBtn.classList.toggle('playing', isPlaying);

  // Sync the Strudel scheduler so audio play/pause matches the canvas.
  // start() resumes from where it left off (or restarts if not yet started).
  if (strudelRepl !== null) {
    if (isPlaying) strudelRepl.start();
    else           strudelRepl.stop();
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
    // Surgical patch — only rhythm lines change, not the full structure
    patchAllRhythms();
    if (audioInitialized) triggerEvaluation();  // debounced, safe on every frame
    return;
  }

  // ── CPM knob ─────────────────────────────────────────────────
  if (cpmDragging) {
    const dy = cpmDragStartY - e.clientY;
    CPM = clamp(cpmDragStartCPM + Math.round(dy * CPM_SENSITIVITY), MIN_CPM, MAX_CPM);
    updateCpmKnobVisual();
    syncStrudelCps();
    patchHeader();  // CPM is only in the header comment — no re-eval needed
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
    // Surgical: only patch rhythm strings — user edits to pattern lines kept
    patchAllRhythms();
    if (audioInitialized) triggerEvaluation();
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
  // No updateTelemetry here — clicking a shape doesn't change code structure
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
    // Surgical: all rhythms change (density changes), structure doesn't
    patchAllRhythms();
    if (audioInitialized) triggerEvaluation();
  } else if (activeShape !== null) {
    activeShape.size = clamp(activeShape.size + (up ? +8 : -8), MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
    activeShape.rebuildIntersectionCache(linkLines);
    // Surgical: only this shape's rhythm line changes
    patchRhythm(activeShape);
    patchHeader();
    if (audioInitialized) triggerEvaluation();
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
  // Mark the currently active instrument
  instrumentBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset['instrument'] === shape.instrument),
  );

  // Show/hide sweeper-specific controls and sync k-slider
  const sweeperControls = soundMenu.querySelector('#sweeper-controls');
  if (sweeperControls) {
    if (shape.type === 'sweeper') {
      sweeperControls.classList.remove('hidden');
      const kSlider = soundMenu.querySelector('#sweeper-k-slider') as HTMLInputElement;
      const kValue = soundMenu.querySelector('#sweeper-k-value');
      if (kSlider && kValue) {
        kSlider.value = shape.k.toString();
        kValue.textContent = shape.k.toString();
      }
    } else {
      sweeperControls.classList.add('hidden');
    }
  }

  // Position above the shape; clamp to stay within viewport top
  soundMenu.style.left = `${shape.x}px`;
  soundMenu.style.top  = `${Math.max(10, shape.y - shape.size - 160)}px`;
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

    // Update active pill state
    instrumentBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Replace this shape's entire code block — instrument change means
    // the pattern template line changes too, not just the rhythm string.
    patchShapeBlock(activeShape);
    patchHeader();
    if (audioInitialized) triggerEvaluation();
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
      updateTelemetry(true);  // regenerate Strudel code
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
//   D     → toggle dock + UI panels
//   I     → toggle telemetry panel
//   Space → play / pause
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
calculateLines();
updateSampleKnobVisual();
updateCpmKnobVisual();
updateTelemetry();

requestAnimationFrame(animate);
