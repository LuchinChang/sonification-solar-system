// src/controls.ts
//
// All UI event handlers: mouse, keyboard, knobs, shape management,
// pattern selector, instrument selection, and playback toggle.

import { CanvasShape, type ShapeType, type PlaybackMode } from './shapes';
import { calculateGeocentricLines, calculateEllipticalLines, clamp } from './engine';
import { PATTERNS, computeAuScale, renderPatternThumbnail } from './patterns';
import type { AppState } from './state';
import {
  MIN_SAMPLES, MAX_SAMPLES, MIN_CPM, MAX_CPM,
  MIN_SHAPE_SIZE, MAX_SHAPE_SIZE,
  KNOB_SENSITIVITY, CPM_SENSITIVITY, DRAG_THRESHOLD,
  sunPos,
} from './state';
import type { DomElements } from './dom';
import type { TourController } from './tour';
import {
  patchRhythm, patchShapeBlock, patchHeader,
  patchAllRhythms, rebuildSweeperPatterns, updateTelemetry,
  setEvalStatus, toggleTelemetry,
} from './telemetry';
import { playLiveCode, syncStrudelCps, resumeAudioContext, suspendAudioContext, getAudioTime } from './audio';
import { setTheme } from './theme';
import { drawScene } from './renderer';

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
  state.shapes.push(s);
  s.rebuildIntersectionCache(state.linkLines);
  if (s.type === 'sweeper') s.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
  setActiveShape(state, s);
  showSoundMenu(dom, s);
  updateTelemetry(dom, state);
  if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value, false);
  tour.notify('shape-spawned');
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
  hideSoundMenu(dom);
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

// ── Pattern selector ─────────────────────────────────────────────────────────

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
    card.className = 'pattern-card';
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

  if (pattern.id === state.currentPattern.id) {
    hidePatternSelector(dom);
    return;
  }

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
  hideSoundMenu(dom);
  updateTelemetry(dom, state);

  hidePatternSelector(dom);
  startDrawAnimation(state, dom);
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
    state.sweepAudioRefTime = getAudioTime();
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
  // Accumulate phase before stopping so the arm resumes from the right position
  const acTime = getAudioTime();
  if (acTime > 0 && state.sweepAudioRefTime > 0) {
    const cycleS = 60 / state.cpm;
    state.sweepPhaseAtRef = (state.sweepPhaseAtRef +
      (acTime - state.sweepAudioRefTime) / cycleS) % 1;
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

// ── Instrument selection ─────────────────────────────────────────────────────

function showSoundMenu(dom: DomElements, shape: CanvasShape): void {
  dom.instrumentBtns.forEach(btn =>
    btn.classList.toggle('active', btn.dataset['instrument'] === shape.instrument),
  );

  const sweeperControls = dom.soundMenu.querySelector('#sweeper-controls');
  if (sweeperControls) {
    if (shape.type === 'sweeper') {
      sweeperControls.classList.remove('hidden');
      const kSliderEl = dom.soundMenu.querySelector('#sweeper-k-slider') as HTMLInputElement;
      const kValueEl  = dom.soundMenu.querySelector('#sweeper-k-value');
      if (kSliderEl && kValueEl) {
        kSliderEl.value      = shape.k.toString();
        kValueEl.textContent = shape.k.toString();
      }
      const armsSliderEl = dom.soundMenu.querySelector('#sweeper-arms-slider') as HTMLInputElement;
      const armsValueEl  = dom.soundMenu.querySelector('#sweeper-arms-value');
      if (armsSliderEl && armsValueEl) {
        armsSliderEl.value      = shape.sweepCount.toString();
        armsValueEl.textContent = shape.sweepCount.toString();
      }
      const posSliderEl = dom.soundMenu.querySelector('#sweeper-pos-slider') as HTMLInputElement;
      const posValueEl  = dom.soundMenu.querySelector('#sweeper-pos-value');
      if (posSliderEl && posValueEl) {
        posSliderEl.value      = shape.ticks.toString();
        posValueEl.textContent = shape.ticks.toString();
      }
    } else {
      sweeperControls.classList.add('hidden');
    }
  }

  dom.soundMenu.classList.remove('hidden');
}

function hideSoundMenu(dom: DomElements): void {
  dom.soundMenu.classList.add('hidden');
}

// ── Evaluate + global flash ──────────────────────────────────────────────────

function evaluateAndFlash(state: AppState, dom: DomElements, tour: TourController): void {
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
  tour.notify('eval-pressed');
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
      showPatternSelector(state, dom);
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

  // Mode toggle
  dom.modeToggle.addEventListener('click', e => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.mode-option');
    if (target?.dataset['mode']) {
      state.playbackMode = target.dataset['mode'] as PlaybackMode;
      dom.modeOptions.forEach(opt =>
        opt.classList.toggle('active', opt.dataset['mode'] === state.playbackMode),
      );
    }
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
      if (!wasActive) showSoundMenu(dom, hit);
      else hideSoundMenu(dom);
    } else {
      setActiveShape(state, null);
      hideSoundMenu(dom);
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
      if (state.activeShape.type === 'sweeper') {
        const step  = Math.PI / 180;
        const delta = up ? -step : step;
        state.activeShape.startAngle = ((state.activeShape.startAngle + delta) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        state.activeShape.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
        drawScene(dom.ctx, state);
        updateTelemetry(dom, state);
        if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      } else {
        state.activeShape.size = clamp(state.activeShape.size + (up ? +2 : -2), MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
        state.activeShape.rebuildIntersectionCache(state.linkLines);
        patchRhythm(dom.telemetryTextarea, state.activeShape);
        patchHeader(dom.telemetryTextarea, state.currentPattern.name, state.shapes.length, state.sampleRate, state.cpm);
      }
    }
  }, { passive: false });

  // Dock — click-to-spawn
  document.querySelectorAll<HTMLButtonElement>('.shape-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      spawnShape(state, dom, (tile.dataset['shape'] ?? 'circle') as ShapeType, tour);
    });
  });

  // Instrument buttons
  dom.instrumentBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.activeShape === null) return;
      const instr = btn.dataset['instrument']!;
      state.activeShape.instrument = instr;
      dom.instrumentBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      patchShapeBlock(dom.telemetryTextarea, state.activeShape, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
      patchHeader(dom.telemetryTextarea, state.currentPattern.name, state.shapes.length, state.sampleRate, state.cpm);
      tour.notify('instrument-picked');
    });
  });

  // Sweeper K-slider
  const kSlider = document.getElementById('sweeper-k-slider') as HTMLInputElement;
  const kValue = document.getElementById('sweeper-k-value');
  if (kSlider && kValue) {
    kSlider.addEventListener('input', () => {
      const k = parseInt(kSlider.value, 10);
      kValue.textContent = k.toString();
      if (state.activeShape?.type === 'sweeper') {
        state.activeShape.k = k;
        state.activeShape.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
        updateTelemetry(dom, state);
        if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      }
    });
  }

  // Sweeper arms slider
  const armsSlider = document.getElementById('sweeper-arms-slider') as HTMLInputElement;
  const armsValue  = document.getElementById('sweeper-arms-value');
  if (armsSlider && armsValue) {
    armsSlider.addEventListener('input', () => {
      const arms = parseInt(armsSlider.value, 10);
      armsValue.textContent = arms.toString();
      if (state.activeShape?.type === 'sweeper') {
        state.activeShape.sweepCount = arms;
        state.activeShape.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
        updateTelemetry(dom, state);
        if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      }
    });
  }

  // Sweeper positions slider
  const posSlider = document.getElementById('sweeper-pos-slider') as HTMLInputElement;
  const posValue  = document.getElementById('sweeper-pos-value');
  if (posSlider && posValue) {
    posSlider.addEventListener('input', () => {
      const ticks = parseInt(posSlider.value, 10);
      posValue.textContent = ticks.toString();
      if (state.activeShape?.type === 'sweeper') {
        state.activeShape.ticks = ticks;
        state.activeShape.rebuildSweepTicks(state.linkLines, state.orbitalMaxRadius);
        updateTelemetry(dom, state);
        if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      }
    });
  }

  // Sync audio button
  dom.syncAudioBtn.addEventListener('click', () => evaluateAndFlash(state, dom, tour));

  // Telemetry tab toggle
  dom.telemetryTab.addEventListener('click', () => {
    const opened = toggleTelemetry(dom);
    if (opened) tour.notify('telemetry-toggled');
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
      evaluateAndFlash(state, dom, tour);
      return;
    }

    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    switch (e.key.toLowerCase()) {
      case 'd':
        document.body.classList.toggle('ui-hidden');
        if (!document.body.classList.contains('ui-hidden')) tour.notify('dock-shown');
        break;
      case 'i':
        {
          const opened = toggleTelemetry(dom);
          if (opened) tour.notify('telemetry-toggled');
        }
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
      case 'p':
        if (!state.drawAnimActive && state.audioInitialized) {
          if (!dom.patternSelectorEl.classList.contains('hidden')) {
            hidePatternSelector(dom);
          } else {
            showPatternSelector(state, dom);
            tour.notify('pattern-opened');
          }
        }
        break;
      case 'backspace':
        e.preventDefault();
        deleteActiveShape(state, dom);
        break;
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
  if (acTime > 0 && state.sweepAudioRefTime > 0) {
    const cycleS_old = 60 / state.cpm;
    state.sweepPhaseAtRef = (state.sweepPhaseAtRef +
      (acTime - state.sweepAudioRefTime) / cycleS_old) % 1;
    state.sweepAudioRefTime = acTime;
  }
}
