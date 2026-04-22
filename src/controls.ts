// src/controls.ts
//
// All UI event handlers: mouse, keyboard, knobs, shape management,
// and playback toggle.

import { CanvasShape, resetNextId, type ShapeType } from './shapes';
import { calculateGeocentricLines, calculateEllipticalLines, clamp } from './engine';
import { PATTERNS, computeAuScale, renderPatternThumbnail, type PlanetaryPattern } from './patterns';
import type { AppState } from './state';
import {
  MIN_SAMPLES, MAX_SAMPLES, MIN_CPM, MAX_CPM,
  // LEGACY: MIN_SHAPE_SIZE only used by the non-sweeper wheel-resize branch.
  // MIN_SHAPE_SIZE,
  MAX_SHAPE_SIZE,
  KNOB_SENSITIVITY, CPM_SENSITIVITY, DRAG_THRESHOLD,
  sunPos,
} from './state';
import type { DomElements } from './dom';
import type { TourController } from './tour';
import {
  // LEGACY: patchRhythm / patchShapeBlock were only used by the non-sweeper
  // wheel-to-resize branch and the removed pattern-bank. To re-enable: add back
  // to this import and restore the call sites.
  // patchRhythm, patchShapeBlock,
  patchHeader,
  patchAllRhythms, rebuildSweeperPatterns, updateTelemetry,
  setEvalStatus, toggleTelemetry,
} from './telemetry';
import { playLiveCode, syncStrudelCps, resumeAudioContext, suspendAudioContext, getAudioTime } from './audio';
import { openEditor, closeEditor, isEditorOpen, currentSweeperId } from './node-editor';
import { setTheme } from './theme';
import { drawScene } from './renderer';
import {
  type ConfigSnapshot,
  SNAPSHOT_VERSION,
  inspectSnapshot,
  downloadSnapshot,
} from './config-snapshot';

// ── Unit 5: Selection / delete reconciliation ────────────────────────────────
//
// The canvas Backspace hotkey must defer to the node-editor's own cable-delete
// handler when (a) the editor panel is open and (b) a cable is currently
// selected. Otherwise Backspace should continue to delete the selected shape,
// preserving the pre-editor user habit.
//
// Duck-typed on `.edge.selected` in the live DOM so this works independently
// of Unit 3's `hasSelectedEdge()` export — if/when that lands, this function
// can switch over without touching callers.
//
// Exported for unit tests — not part of the public module surface.
export function editorShouldConsumeDeleteKey(): boolean {
  if (typeof document === 'undefined') return false;
  const panel = document.getElementById('node-editor-panel');
  const panelOpen = panel !== null && !panel.classList.contains('hidden');
  if (!panelOpen) return false;
  return document.querySelector('.edge.selected') !== null;
}

// ── Orbital line computation ─────────────────────────────────────────────────

export function calculateLines(state: AppState, canvas: HTMLCanvasElement): void {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  if (state.currentPattern.geocentric) {
    state.linkLines = calculateGeocentricLines(
      cx, cy, state.sampleRate,
      state.currentOuterR, state.currentInnerR,
      state.currentOuterPeriod, state.currentInnerPeriod,
      state.currentSimYears,
      state.currentPattern.eccentricity1 ?? 0,
      state.currentPattern.precessionPeriodYears1 ?? 1000,
    );
  } else {
    state.linkLines = calculateEllipticalLines(
      cx, cy, state.sampleRate,
      state.currentPattern.planet1, state.currentPattern.planet2,
      state.currentSimYears, state.currentAuScale,
    );
  }
  state.fullLinkLines = state.linkLines;
  rebuildAllCaches(state);
}

// ── Shape management ─────────────────────────────────────────────────────────

export function rebuildAllCaches(state: AppState): void {
  for (const s of state.shapes) {
    s.rebuildIntersectionCache(state.linkLines);
    if (s.type === 'sweeper') s.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
  }
}

export function spawnShape(
  state: AppState,
  dom: DomElements,
  type: ShapeType,
  tour: TourController,
): void {
  const { x, y } = sunPos(dom.canvas);
  const size = type === 'sweeper' ? MAX_SHAPE_SIZE : undefined;
  const s = new CanvasShape(x, y, type, size);
  if (type === 'sweeper') {
    // Auto-offset startAngle and assign distinct colour for each new sweeper
    const existing = state.shapes.filter(sh => sh.type === 'sweeper');
    s.startAngle = (3 * Math.PI / 2 + existing.length * Math.PI / 4) % (Math.PI * 2);
    s.colorIndex = existing.length;
  }
  state.shapes.push(s);
  s.rebuildIntersectionCache(state.linkLines);
  if (s.type === 'sweeper') s.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
  setActiveShape(state, s);
  updateTelemetry(dom, state);
  if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value, false);
  if (type === 'sweeper') tour.notify('sweeper-spawned');
}

export function setActiveShape(state: AppState, s: CanvasShape | null): void {
  state.shapes.forEach(sh => { sh.isSelected = false; });
  state.activeShape = s;
  if (s !== null) s.isSelected = true;
}

export function deleteActiveShape(state: AppState, dom: DomElements): void {
  if (state.activeShape === null) return;
  const idx = state.shapes.indexOf(state.activeShape);
  if (idx !== -1) state.shapes.splice(idx, 1);
  state.flashCooldowns.delete(state.activeShape.id);
  state.activeShape = null;
  updateTelemetry(dom, state);
}

// ── Draw animation ───────────────────────────────────────────────────────────

function startDrawAnimation(state: AppState, dom: DomElements): void {
  state.drawAnimActive    = true;
  state.drawAnimStartTime = performance.now();
  state.drawAnimDurationMs = Math.min(state.currentPattern.simYears * 1500, 25000);
  state.drawAnimProgress  = 0;
  state.drawLineCount     = 0;
  state.currentCaptionText = '';

  dom.captionEl.classList.remove('hidden');
  dom.captionEl.classList.remove('visible');
  dom.captionEl.textContent = '';

  dom.toastEl.textContent = 'Press Space to skip animation';
  dom.toastEl.classList.remove('hidden', 'fade-out');

  if (state.isPlaying) togglePlayback(state, dom);
}

export function updateCaption(state: AppState, dom: DomElements, progress: number): void {
  const caps = state.currentPattern.captions;
  let active: typeof caps[0] | null = null;
  for (let i = caps.length - 1; i >= 0; i--) {
    if (progress >= caps[i].atProgress) { active = caps[i]; break; }
  }

  if (active && active.text !== state.currentCaptionText) {
    state.currentCaptionText = active.text;
    dom.captionEl.textContent = active.text;
    dom.captionEl.classList.add('visible');
    if (state.captionTimeoutId) clearTimeout(state.captionTimeoutId);
    state.captionTimeoutId = setTimeout(() => {
      dom.captionEl.classList.remove('visible');
    }, active.duration * 1000);
  }
}

export function finishDrawAnimation(state: AppState, dom: DomElements, tour: TourController): void {
  state.drawAnimActive = false;
  state.drawAnimProgress = 1;
  state.drawLineCount = state.fullLinkLines.length;
  state.linkLines = state.fullLinkLines;
  rebuildAllCaches(state);

  dom.captionEl.classList.remove('visible');
  dom.captionEl.classList.add('hidden');
  if (state.captionTimeoutId) clearTimeout(state.captionTimeoutId);
  state.currentCaptionText = '';

  dom.toastEl.textContent = 'Pattern ready \u2014 spawn shapes to explore';
  dom.toastEl.classList.remove('hidden', 'fade-out');
  setTimeout(() => dom.toastEl.classList.add('fade-out'), 2500);
  setTimeout(() => dom.toastEl.classList.add('hidden'), 3200);

  setTimeout(() => tour.start(), 800);
}

// ── Pattern application ──────────────────────────────────────────────────────
// Swaps the active planetary pattern: recomputes orbital radii, rebuilds link
// lines, clears existing shapes, and kicks off the draw-animation. Shared by
// the Start-Engine bootstrap (first pattern) and the P-hotkey picker.

function applyPattern(state: AppState, dom: DomElements, pattern: PlanetaryPattern): void {
  state.currentPattern = pattern;

  const minDim = Math.min(dom.canvas.width, dom.canvas.height);
  state.currentAuScale = computeAuScale(pattern, minDim);

  const au1 = Math.min(pattern.au1, pattern.au2);
  const au2 = Math.max(pattern.au1, pattern.au2);
  state.currentInnerR = au1 * state.currentAuScale;
  state.currentOuterR = au2 * state.currentAuScale;

  if (pattern.au1 < pattern.au2) {
    state.currentInnerPeriod = pattern.period1;
    state.currentOuterPeriod = pattern.period2;
  } else {
    state.currentInnerPeriod = pattern.period2;
    state.currentOuterPeriod = pattern.period1;
  }
  state.currentSimYears = pattern.simYears;
  state.orbitalMaxRadius = state.currentOuterR * 1.05;

  const cx = dom.canvas.width / 2;
  const cy = dom.canvas.height / 2;
  if (pattern.geocentric) {
    state.fullLinkLines = calculateGeocentricLines(
      cx, cy, state.sampleRate,
      state.currentOuterR, state.currentInnerR,
      state.currentOuterPeriod, state.currentInnerPeriod,
      state.currentSimYears,
      pattern.eccentricity1 ?? 0,
      pattern.precessionPeriodYears1 ?? 1000,
    );
  } else {
    state.fullLinkLines = calculateEllipticalLines(
      cx, cy, state.sampleRate,
      pattern.planet1, pattern.planet2,
      state.currentSimYears, state.currentAuScale,
    );
  }
  state.linkLines = state.fullLinkLines;

  while (state.shapes.length > 0) state.shapes.pop();
  state.activeShape = null;
  state.flashCooldowns.clear();
  updateTelemetry(dom, state);

  startDrawAnimation(state, dom);
}

// ── Pattern selector modal (P hotkey) ────────────────────────────────────────
// Keyboard-triggered picker of pre-defined planetary patterns. Parallel to
// the node editor — selecting a pattern swaps the active link-line field and
// re-runs the draw-animation.

function showPatternSelector(state: AppState, dom: DomElements): void {
  if (state.isPlaying) togglePlayback(state, dom);

  if (state.drawAnimActive) {
    state.drawAnimActive = false;
    dom.captionEl.classList.remove('visible');
    dom.captionEl.classList.add('hidden');
    if (state.captionTimeoutId) clearTimeout(state.captionTimeoutId);
  }

  dom.patternCardsEl.innerHTML = '';
  const thumbColor = state.currentTheme === 'dark'
    ? 'rgba(194, 118, 46, 0.4)'
    : 'rgba(92, 58, 33, 0.35)';

  for (const pattern of PATTERNS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pattern-card';
    if (pattern.id === state.currentPattern.id) card.classList.add('active');
    card.dataset['pattern'] = pattern.id;

    const thumb = renderPatternThumbnail(pattern, 120, thumbColor);
    thumb.className = 'pattern-thumb';
    card.appendChild(thumb);

    const planets = document.createElement('span');
    planets.className = 'pattern-card-planets';
    planets.textContent = `${pattern.planet1} \u2014 ${pattern.planet2}`;
    card.appendChild(planets);

    card.addEventListener('click', () => selectPattern(state, dom, pattern.id));
    dom.patternCardsEl.appendChild(card);
  }

  dom.patternSelectorEl.classList.remove('hidden');
}

function hidePatternSelector(dom: DomElements): void {
  dom.patternSelectorEl.classList.add('hidden');
}

function selectPattern(state: AppState, dom: DomElements, patternId: string): void {
  const pattern = PATTERNS.find(p => p.id === patternId);
  if (!pattern) return;

  hidePatternSelector(dom);
  if (pattern.id === state.currentPattern.id) return;

  applyPattern(state, dom, pattern);
}

// ── Playback toggle (refactored from 191-line monolith) ──────────────────────

export function togglePlayback(state: AppState, dom: DomElements): void {
  state.isPlaying = !state.isPlaying;
  dom.playPauseBtn.textContent = state.isPlaying ? '⏸' : '▶';
  dom.playPauseBtn.setAttribute('aria-label', state.isPlaying ? 'Pause playback' : 'Resume playback');
  dom.playPauseBtn.classList.toggle('playing', state.isPlaying);

  if (state.isPlaying) {
    startPlayback(state, dom);
  } else {
    pausePlayback(state);
  }
}

function startPlayback(state: AppState, dom: DomElements): void {
  state.lastFrameTime = 0;
  if (state.strudelRepl !== null) {
    resumeAudioContext();
    state.strudelRepl.start();
    // Anchor each sweeper arm to this exact audio moment.
    // Per-shape sweepPhaseAtRef is preserved from the last pause so arms
    // resume from the same position without jumping.
    const t = getAudioTime();
    for (const s of state.shapes) {
      if (s.type === 'sweeper') s.sweepAudioRefTime = t;
    }
    state.strudelRepl.evaluate(dom.telemetryTextarea.value)
      .then(() => setEvalStatus(dom.evalStatusEl, 'ok'))
      .catch((err: unknown) => {
        console.warn('[strudel-eval async]', err);
        setEvalStatus(dom.evalStatusEl, 'error');
        // Bug fix: if evaluate fails, stop the clock to avoid running with no pattern
        if (state.strudelRepl) state.strudelRepl.stop();
        state.isPlaying = false;
        dom.playPauseBtn.textContent = '▶';
        dom.playPauseBtn.setAttribute('aria-label', 'Resume playback');
        dom.playPauseBtn.classList.remove('playing');
      });
  }
}

function pausePlayback(state: AppState): void {
  // Accumulate phase per-shape before stopping so each arm resumes correctly.
  const acTime = getAudioTime();
  if (acTime > 0) {
    const cycleS = 60 / state.cpm;
    for (const s of state.shapes) {
      if (s.type === 'sweeper' && s.sweepAudioRefTime > 0) {
        s.sweepPhaseAtRef = (s.sweepPhaseAtRef +
          (acTime - s.sweepAudioRefTime) / cycleS) % 1;
      }
    }
  }
  if (state.strudelRepl !== null) state.strudelRepl.stop();
  suspendAudioContext();
}

// ── Knob visuals ─────────────────────────────────────────────────────────────

function updateSampleKnobVisual(state: AppState, dom: DomElements): void {
  const pct   = (state.sampleRate - MIN_SAMPLES) / (MAX_SAMPLES - MIN_SAMPLES);
  const angle = -135 + pct * 270;
  dom.knobNeedleGroup.style.transform = `rotate(${angle}deg)`;
  dom.knobValueEl.textContent = String(state.sampleRate);
  dom.sampleKnobEl.setAttribute('aria-valuenow', String(state.sampleRate));
}

function updateCpmKnobVisual(state: AppState, dom: DomElements): void {
  const pct   = (state.cpm - MIN_CPM) / (MAX_CPM - MIN_CPM);
  const angle = -135 + pct * 270;
  dom.cpmNeedleGroup.style.transform = `rotate(${angle}deg)`;
  dom.cpmValueEl.textContent = String(state.cpm);
  dom.cpmKnobEl.setAttribute('aria-valuenow', String(state.cpm));
}

// ── Evaluate + global flash ──────────────────────────────────────────────────

function evaluateAndFlash(state: AppState, dom: DomElements): void {
  if (!state.audioInitialized) return;
  playLiveCode(state.strudelRepl, dom.telemetryTextarea.value)
    .then(status => setEvalStatus(dom.evalStatusEl, status));

  const panelOpen = !dom.telemetryPanel.classList.contains('collapsed');
  if (panelOpen) {
    dom.telemetryTextarea.classList.add('code-flash');
    setTimeout(() => dom.telemetryTextarea.classList.remove('code-flash'), 150);
  } else {
    document.body.classList.add('global-flash');
    setTimeout(() => document.body.classList.remove('global-flash'), 450);
  }
}

// ── Resize handler ───────────────────────────────────────────────────────────

export function handleResize(state: AppState, dom: DomElements): void {
  dom.canvas.width  = window.innerWidth;
  dom.canvas.height = window.innerHeight;
  if (state.currentPattern) {
    const minDim = Math.min(dom.canvas.width, dom.canvas.height);
    state.currentAuScale = computeAuScale(state.currentPattern, minDim);
    state.currentOuterR = Math.max(state.currentPattern.au1, state.currentPattern.au2) * state.currentAuScale;
    state.currentInnerR = Math.min(state.currentPattern.au1, state.currentPattern.au2) * state.currentAuScale;
    state.orbitalMaxRadius = state.currentOuterR * 1.05;
  }
  calculateLines(state, dom.canvas);
  drawScene(dom.ctx, state);
}

// ── Config snapshot save/load ────────────────────────────────────────────────

function buildSnapshot(state: AppState): ConfigSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    patternId:    state.currentPattern.id,
    sampleRate:   state.sampleRate,
    cpm:          state.cpm,
    // Unit 1 removed the global Const T / Const V toggle — always constant-time.
    // Field kept in snapshot schema for backward-compat with pre-Unit-1 files.
    playbackMode: 'constant-time',
    theme:        state.currentTheme,
    shapes:       state.shapes.map(s => s.toConfig()),
  };
}

function showToast(dom: DomElements, msg: string): void {
  dom.toastEl.textContent = msg;
  dom.toastEl.classList.remove('hidden');
  dom.toastEl.classList.add('config-toast');
  setTimeout(() => {
    dom.toastEl.classList.add('hidden');
    dom.toastEl.classList.remove('config-toast');
  }, 2500);
}

function saveConfig(state: AppState, dom: DomElements): void {
  downloadSnapshot(buildSnapshot(state));
  showToast(dom, 'Configuration saved');
}

function restoreFromSnapshot(state: AppState, dom: DomElements, snap: ConfigSnapshot): void {
  // 1 — Pattern (must be first: rebuilds linkLines)
  const pat = PATTERNS.find(p => p.id === snap.patternId);
  if (!pat) { showToast(dom, 'Unknown pattern: ' + snap.patternId); return; }

  // Set pattern without triggering the draw animation
  state.currentPattern = pat;
  const minDim = Math.min(dom.canvas.width, dom.canvas.height);
  state.currentAuScale = computeAuScale(pat, minDim);
  const au1 = Math.min(pat.au1, pat.au2);
  const au2 = Math.max(pat.au1, pat.au2);
  state.currentInnerR = au1 * state.currentAuScale;
  state.currentOuterR = au2 * state.currentAuScale;
  if (pat.au1 < pat.au2) {
    state.currentInnerPeriod = pat.period1;
    state.currentOuterPeriod = pat.period2;
  } else {
    state.currentInnerPeriod = pat.period2;
    state.currentOuterPeriod = pat.period1;
  }
  state.currentSimYears  = pat.simYears;
  state.orbitalMaxRadius = state.currentOuterR * 1.05;

  // Rebuild link lines with restored sample rate
  state.sampleRate = snap.sampleRate;
  calculateLines(state, dom.canvas);   // also calls rebuildAllCaches

  // 2 — Global params
  state.cpm          = snap.cpm;
  // Unit 1: snap.playbackMode is accepted by the schema for backward compat
  // but no longer applied — the app is always constant-time globally.
  state.currentTheme = snap.theme;
  setTheme(snap.theme, dom.themeToggleBtn);
  updateSampleKnobVisual(state, dom);
  updateCpmKnobVisual(state, dom);
  syncStrudelCps(state.strudelRepl, state.cpm);

  // 3 — Clear existing shapes
  state.shapes.length = 0;
  state.activeShape   = null;
  state.flashCooldowns.clear();

  // 4 — Recreate shapes from config
  let maxId = 0;
  for (const cfg of snap.shapes) {
    const s = CanvasShape.fromConfig(cfg);
    s.rebuildIntersectionCache(state.linkLines);
    if (s.type === 'sweeper') s.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
    state.shapes.push(s);
    if (s.id > maxId) maxId = s.id;
  }
  resetNextId(maxId);

  // 5 — Regenerate Strudel code
  updateTelemetry(dom, state);
  if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value, false);

  showToast(dom, `Restored: ${pat.name} — ${snap.shapes.length} shape(s)`);
}

function handleConfigFile(state: AppState, dom: DomElements, file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string);
      const rejection = inspectSnapshot(data);
      if (rejection !== null) {
        const msg = rejection.kind === 'legacy-version'
          ? 'Legacy v1 config — please recreate your scene (no migration)'
          : `Invalid config: ${rejection.message}`;
        showToast(dom, msg);
        return;
      }
      restoreFromSnapshot(state, dom, data as ConfigSnapshot);
    } catch {
      showToast(dom, 'Could not parse config file');
    }
  };
  reader.readAsText(file);
}

// ── Master event handler setup ───────────────────────────────────────────────

export function setupEventHandlers(
  state: AppState,
  dom: DomElements,
  tour: TourController,
): void {
  // Resize
  window.addEventListener('resize', () => handleResize(state, dom));

  // Start engine button
  dom.audioOverlay.querySelector('#start-engine-btn')?.addEventListener('click', async () => {
    try {
      const { initializeAudio } = await import('./audio');
      const replInstance = await initializeAudio();
      state.strudelRepl = replInstance;
      replInstance.setCps(state.cpm / 60);
      state.audioInitialized = true;
      dom.audioOverlay.classList.add('hidden');
      updateTelemetry(dom, state);
      playLiveCode(state.strudelRepl, dom.telemetryTextarea.value, false);
      applyPattern(state, dom, PATTERNS[0]);
    } catch (err) {
      console.error('[audio] init failed:', err);
    }
  });

  // Sample rate knob
  dom.sampleKnobEl.addEventListener('mousedown', e => {
    state.knobDragging      = true;
    state.knobDragStartY    = e.clientY;
    state.knobDragStartRate = state.sampleRate;
    e.preventDefault();
    e.stopPropagation();
  });

  dom.sampleKnobEl.addEventListener('keydown', e => {
    let delta = 0;
    if (e.key === 'ArrowUp'   || e.key === 'ArrowRight') delta = +25;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')  delta = -25;
    if (delta === 0) return;
    e.preventDefault();
    state.sampleRate = clamp(state.sampleRate + delta, MIN_SAMPLES, MAX_SAMPLES);
    calculateLines(state, dom.canvas);
    updateSampleKnobVisual(state, dom);
    patchAllRhythms(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
    const hasSweeper = rebuildSweeperPatterns(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
    if (hasSweeper && state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
  });

  // CPM knob
  dom.cpmKnobEl.addEventListener('mousedown', e => {
    state.cpmDragging     = true;
    state.cpmDragStartY   = e.clientY;
    state.cpmDragStartCPM = state.cpm;
    e.preventDefault();
    e.stopPropagation();
  });

  dom.cpmKnobEl.addEventListener('keydown', e => {
    let delta = 0;
    if (e.key === 'ArrowUp'   || e.key === 'ArrowRight') delta = +5;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')  delta = -5;
    if (delta === 0) return;
    e.preventDefault();
    anchorSweepPhase(state);
    state.cpm = clamp(state.cpm + delta, MIN_CPM, MAX_CPM);
    updateCpmKnobVisual(state, dom);
    syncStrudelCps(state.strudelRepl, state.cpm);
    patchHeader(dom.telemetryTextarea, state.currentPattern.name, state.shapes.length, state.sampleRate, state.cpm);
  });

  // Play/Pause
  dom.playPauseBtn.addEventListener('click', () => {
    tour.notify('play-pressed');
    togglePlayback(state, dom);
  });

  // Global mousemove (three concurrent drags)
  window.addEventListener('mousemove', e => {
    if (state.knobDragging) {
      const dy = state.knobDragStartY - e.clientY;
      state.sampleRate = clamp(state.knobDragStartRate + Math.round(dy * KNOB_SENSITIVITY), MIN_SAMPLES, MAX_SAMPLES);
      calculateLines(state, dom.canvas);
      updateSampleKnobVisual(state, dom);
      patchAllRhythms(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
      const hasSweeper = rebuildSweeperPatterns(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
      if (hasSweeper && state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      return;
    }

    if (state.cpmDragging) {
      const dy     = state.cpmDragStartY - e.clientY;
      const newCPM = clamp(state.cpmDragStartCPM + Math.round(dy * CPM_SENSITIVITY), MIN_CPM, MAX_CPM);
      if (newCPM !== state.cpm && state.isPlaying && state.audioInitialized) {
        anchorSweepPhase(state);
      }
      state.cpm = newCPM;
      updateCpmKnobVisual(state, dom);
      syncStrudelCps(state.strudelRepl, state.cpm);
      patchHeader(dom.telemetryTextarea, state.currentPattern.name, state.shapes.length, state.sampleRate, state.cpm);
      return;
    }

    if (state.shapeDragTarget === null) return;
    if (Math.hypot(e.clientX - state.mouseDownPos.x, e.clientY - state.mouseDownPos.y) < DRAG_THRESHOLD) return;

    state.didDragShape        = true;
    state.shapeDragTarget.x   = e.clientX + state.shapeDragOffset.x;
    state.shapeDragTarget.y   = e.clientY + state.shapeDragOffset.y;
    state.shapeDragTarget.rebuildIntersectionCache(state.linkLines);
  });

  // Global mouseup
  window.addEventListener('mouseup', () => {
    state.knobDragging    = false;
    state.cpmDragging     = false;
    state.shapeDragTarget = null;
  });

  // Canvas mousedown (shape drag start)
  dom.canvas.addEventListener('mousedown', e => {
    state.mouseDownPos = { x: e.clientX, y: e.clientY };
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      if (state.shapes[i].containsPoint(e.clientX, e.clientY)) {
        state.shapeDragTarget   = state.shapes[i];
        state.shapeDragOffset.x = state.shapes[i].x - e.clientX;
        state.shapeDragOffset.y = state.shapes[i].y - e.clientY;
        break;
      }
    }
  });

  // Canvas click (select / deselect)
  dom.canvas.addEventListener('click', e => {
    if (state.didDragShape) {
      state.didDragShape = false;
      patchAllRhythms(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
      return;
    }

    let hit: CanvasShape | null = null;
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      if (state.shapes[i].containsPoint(e.clientX, e.clientY)) { hit = state.shapes[i]; break; }
    }

    if (hit !== null) {
      const wasActive = hit === state.activeShape;
      setActiveShape(state, wasActive ? null : hit);
    } else {
      setActiveShape(state, null);
    }
  });

  // Canvas wheel (resize shape / adjust sample rate)
  dom.canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const up = e.deltaY < 0;

    if (e.metaKey || e.ctrlKey) {
      state.sampleRate = clamp(state.sampleRate + (up ? +25 : -25), MIN_SAMPLES, MAX_SAMPLES);
      calculateLines(state, dom.canvas);
      updateSampleKnobVisual(state, dom);
      patchAllRhythms(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
      const hasSweeper = rebuildSweeperPatterns(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
      if (hasSweeper && state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
    } else if (state.activeShape !== null) {
      // Sweeper-only: wheel rotates the 12 o'clock start angle by 1°.
      // LEGACY: disabled 2026-04-21 — non-sweeper wheel-to-resize branch
      // (clamped size + rhythm re-patch). To re-enable: restore the else
      // branch and non-sweeper ShapeTypes.
      /*
      if (state.activeShape.type !== 'sweeper') {
        state.activeShape.size = clamp(state.activeShape.size + (up ? +2 : -2), MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
        state.activeShape.rebuildIntersectionCache(state.linkLines);
        patchRhythm(dom.telemetryTextarea, state.activeShape);
        patchHeader(dom.telemetryTextarea, state.currentPattern.name, state.shapes.length, state.sampleRate, state.cpm);
      } else {
      */
      if (state.activeShape.type === 'sweeper') {
        const step  = Math.PI / 180;
        const delta = up ? -step : step;
        state.activeShape.startAngle = ((state.activeShape.startAngle + delta) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        state.activeShape.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
        drawScene(dom.ctx, state);
        updateTelemetry(dom, state);
        if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      }
    }
  }, { passive: false });

  // Dock — click-to-spawn.
  // Unit 3 will strip legacy shape tiles from the dock entirely. For now we
  // ignore clicks from any non-'sweeper' tile so legacy tiles are a no-op
  // (no runtime errors). ShapeType is narrowed to 'sweeper' in shapes.ts.
  document.querySelectorAll<HTMLButtonElement>('.shape-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      const requested = tile.dataset['shape'] ?? 'sweeper';
      // LEGACY: previously passed requested value cast as ShapeType (allowing
      // 'circle' | 'triangle' | 'rectangle'). Now we short-circuit to a no-op
      // for any non-sweeper tile.
      if (requested !== 'sweeper') return;
      spawnShape(state, dom, 'sweeper' as ShapeType, tour);
    });
  });

  // Minimal dock sweeper-spawn affordance (Unit 3): click + N hotkey
  document.querySelectorAll<HTMLButtonElement>('.sweeper-spawn-btn').forEach(btn => {
    btn.addEventListener('click', () => spawnShape(state, dom, 'sweeper' as ShapeType, tour));
  });

  // Save / load config snapshot — drag-drop, buttons, file input
  dom.canvas.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    dom.dropOverlay.classList.remove('hidden');
  });
  dom.dropOverlay.addEventListener('dragleave', e => {
    e.preventDefault();
    dom.dropOverlay.classList.add('hidden');
  });
  dom.dropOverlay.addEventListener('drop', e => {
    e.preventDefault();
    dom.dropOverlay.classList.add('hidden');
    const file = e.dataTransfer?.files[0];
    if (file) handleConfigFile(state, dom, file);
  });
  dom.saveConfigBtn.addEventListener('click', () => saveConfig(state, dom));
  dom.loadConfigBtn.addEventListener('click', () => dom.loadConfigInput.click());
  dom.loadConfigInput.addEventListener('change', () => {
    const file = dom.loadConfigInput.files?.[0];
    if (file) handleConfigFile(state, dom, file);
    dom.loadConfigInput.value = '';  // allow re-selecting the same file
  });

  // Sync audio button
  dom.syncAudioBtn.addEventListener('click', () => evaluateAndFlash(state, dom));

  // Telemetry tab toggle
  dom.telemetryTab.addEventListener('click', () => {
    toggleTelemetry(dom);
  });

  // Theme toggle
  dom.themeToggleBtn.addEventListener('click', () => {
    state.currentTheme = state.currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(state.currentTheme, dom.themeToggleBtn);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    // Ctrl/Cmd+Enter: global
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      evaluateAndFlash(state, dom);
      return;
    }

    // Ctrl/Cmd+S: save config snapshot (global, works from text inputs too)
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveConfig(state, dom);
      return;
    }

    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    // Escape closes the pattern selector without applying. Global so it fires
    // regardless of focus (but still gated above on text-input targets).
    if (e.key === 'Escape' && !dom.patternSelectorEl.classList.contains('hidden')) {
      e.preventDefault();
      hidePatternSelector(dom);
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'd':
        document.body.classList.toggle('ui-hidden');
        break;
      case 'i':
        toggleTelemetry(dom);
        break;
      case ' ':
        e.preventDefault();
        if (state.drawAnimActive) {
          finishDrawAnimation(state, dom, tour);
        } else {
          tour.notify('play-pressed');
          togglePlayback(state, dom);
        }
        break;
      case 'backspace':
        // Unit 5 — Selection / delete reconciliation (#13).
        // If the node editor is open AND has a selected cable, let its own
        // Backspace handler delete the cable instead of the shape.
        if (editorShouldConsumeDeleteKey()) break;
        e.preventDefault();
        deleteActiveShape(state, dom);
        break;
      case 'n':
        // N: spawn a sweeper at the Sun (Unit 3 minimal affordance)
        spawnShape(state, dom, 'sweeper' as ShapeType, tour);
        break;
      case 'p':
        // P: toggle the pattern-selector modal (Unit 5 restore).
        // Available once audio is initialised — before that, no pattern is
        // active so swapping has no meaning.
        if (!state.audioInitialized) break;
        if (dom.patternSelectorEl.classList.contains('hidden')) {
          showPatternSelector(state, dom);
        } else {
          hidePatternSelector(dom);
        }
        break;
      case 'e': {
        // E toggle: close if open-for-same / no-active-sweeper, else (re)open
        // for the active sweeper. openEditor itself no-ops back to closed when
        // called with the id it's already showing.
        const active = state.activeShape;
        const sweeperId = active !== null && active.type === 'sweeper' ? active.id : null;
        if (sweeperId === null || sweeperId === currentSweeperId()) {
          if (isEditorOpen()) closeEditor();
        } else {
          e.preventDefault();
          openEditor(sweeperId);
          tour.notify('editor-opened');
        }
        break;
      }
    }
  });

  // Initial visuals
  updateSampleKnobVisual(state, dom);
  updateCpmKnobVisual(state, dom);
}

// ── Helper: anchor sweep phase before CPM change ─────────────────────────────

function anchorSweepPhase(state: AppState): void {
  if (!state.isPlaying || !state.audioInitialized) return;
  const acTime = getAudioTime();
  if (acTime <= 0) return;
  const cycleS_old = 60 / state.cpm;
  for (const s of state.shapes) {
    if (s.type === 'sweeper' && s.sweepAudioRefTime > 0) {
      s.sweepPhaseAtRef  = (s.sweepPhaseAtRef +
        (acTime - s.sweepAudioRefTime) / cycleS_old) % 1;
      s.sweepAudioRefTime = acTime;
    }
  }
}
