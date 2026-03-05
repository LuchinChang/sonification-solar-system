// src/main.ts
import './style.css';
import type { Point } from './geometry';
import { CanvasShape, type ShapeType, type SoundCategory, type PlaybackMode } from './shapes';

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
// TELEMETRY PANEL  — DOM-element approach for per-shape flash
// ═══════════════════════════════════════════════════════════════

const telemetryCode  = document.getElementById('telemetry-code')!;
const telemetryPanel = document.getElementById('telemetry-panel')!;
const telemetryTab   = document.getElementById('telemetry-tab') as HTMLButtonElement;

/** Re-render the entire telemetry <pre> block using individual <span>s. */
function updateTelemetry(): void {
  telemetryCode.innerHTML = '';

  const header = document.createElement('span');
  header.className = 'telem-header';
  header.textContent = [
    '// Solar System Sonification — Live Code',
    '// ─────────────────────────────────────────',
    `// Shapes: ${shapes.length}  |  Samples: ${SAMPLE_RATE}  |  CPM: ${CPM}`,
    '',
  ].join('\n');
  telemetryCode.appendChild(header);

  if (shapes.length === 0) {
    const empty = document.createElement('span');
    empty.textContent = '// Spawn shapes from the Sonic Foundry dock.';
    telemetryCode.appendChild(empty);
    return;
  }

  shapes.forEach((s, i) => {
    if (i > 0) telemetryCode.appendChild(document.createTextNode('\n\n'));
    const block = document.createElement('span');
    block.id        = `telem-shape-${s.id}`;
    block.className = 'telem-block';
    block.textContent = s.toStrudelCode();
    telemetryCode.appendChild(block);
  });
}

/**
 * Briefly flash the telemetry block for `shape` with a coral glow.
 * Debounced per shape to avoid strobe at high CPM / dense intersections.
 */
const _flashCooldowns = new Map<number, number>();
const FLASH_COOLDOWN_MS = 80;

function flashTelemBlock(shape: CanvasShape, now: number): void {
  const last = _flashCooldowns.get(shape.id) ?? 0;
  if (now - last < FLASH_COOLDOWN_MS) return;
  _flashCooldowns.set(shape.id, now);

  const el = document.getElementById(`telem-shape-${shape.id}`);
  if (el === null) return;
  el.classList.remove('telem-flash');
  void el.offsetWidth; // force reflow to restart the CSS animation
  el.classList.add('telem-flash');
}

function toggleTelemetry(): void {
  const collapsed = telemetryPanel.classList.toggle('collapsed');
  telemetryTab.setAttribute('aria-expanded', String(!collapsed));
}
telemetryTab.addEventListener('click', toggleTelemetry);

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
  updateTelemetry();
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
    updateTelemetry();
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

const soundMenu  = document.getElementById('sound-menu')!;
const soundPills = soundMenu.querySelectorAll<HTMLButtonElement>('.sound-pill');

function showSoundMenu(shape: CanvasShape): void {
  soundPills.forEach(p =>
    p.classList.toggle('active', p.dataset['category'] === shape.soundProfile.category),
  );
  soundMenu.style.left = `${shape.x}px`;
  soundMenu.style.top  = `${shape.y - shape.size - 46}px`;
  soundMenu.classList.remove('hidden');
}

function hideSoundMenu(): void {
  soundMenu.classList.add('hidden');
}

soundPills.forEach(pill => {
  pill.addEventListener('click', () => {
    if (activeShape === null) return;
    activeShape.soundProfile.category = pill.dataset['category'] as SoundCategory;
    soundPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    updateTelemetry();
  });
});

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
calculateLines();          // also calls rebuildAllCaches() (no shapes yet, so noop)
updateSampleKnobVisual();
updateCpmKnobVisual();
updateTelemetry();

// Kick off the continuous animation loop
requestAnimationFrame(animate);
