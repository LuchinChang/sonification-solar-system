// src/controls.ts
//
// All UI event handlers: mouse, keyboard, knobs, shape management,
// and playback toggle.

import { CanvasShape, PROBE_PALETTE_SIZE, resetNextId, type ShapeType } from './shapes';
import { calculateGeocentricLines, calculateEllipticalLines, calculateCardioidLines, calculateMoonHexagonLines, SOLAR_SYNODIC_ROTATION_DAYS, MOON_VIEW_JITTER_DAYS, MOON_VIEW_JITTER_PERIOD_DAYS, clamp } from './engine';
import { PATTERNS, computeAuScale, computePatternLines, renderPatternThumbnail, type PlanetaryPattern } from './patterns';
import { PLANET_ORDER, computeResonance, getPatternForPair, patternFromId } from './pattern-generator';
import { findNodalPoints, type NodalPoint } from './nodal-points';
import { playNodalChord, stopNodalChord, chordGlow } from './nodal-chord';
import {
  loadSettings, saveSettings, loadUnlocked, saveUnlocked,
  settingsAsCode, NODAL_CHORD_DEFAULT_ON, type PlaygroundSettings,
} from './playground-settings';
import { createPreviewLoop, type PreviewLoop } from './pattern-preview';
import { ELEMENTS } from './orbital-elements';
import type { AppState } from './state';
import { revealDurationMs, GUIDED_PHASE_MS } from './reveal';
import {
  MIN_SAMPLES, MAX_SAMPLES, MIN_CPM, MAX_CPM,
  // MIN_SHAPE_SIZE drives wheel-to-resize for discrete circle probes.
  MIN_SHAPE_SIZE,
  MAX_SHAPE_SIZE,
  KNOB_SENSITIVITY, CPM_SENSITIVITY, DRAG_THRESHOLD,
  sunPos, sweeperMaxR,
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
import { playLiveCode, syncStrudelCps, resumeAudioContext, suspendAudioContext, getAudioTime, setMuted } from './audio';
import { openEditor, closeEditor, isEditorOpen, currentSweeperId } from './node-editor';
import { setTheme } from './theme';
import { saveMuted } from './mute';
import { initKeyboardShortcutsPanel } from './keyboard-shortcuts';
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
  const pattern = state.currentPattern;
  if (pattern.kind === 'cardioid' && pattern.cardioid) {
    state.linkLines = calculateCardioidLines(
      cx, cy,
      state.sampleRate, pattern.cardioid.multiplier, pattern.cardioid.radius,
    );
  } else if (pattern.kind === 'moon-hexagon') {
    const a = state.currentInnerR;
    const e = pattern.eccentricity1 ?? 0;
    const anomMonth = pattern.period1 ?? 27.5545;
    const apsidalDays = (pattern.precessionPeriodYears1 ?? 8.85) * 365.25;
    state.linkLines = calculateMoonHexagonLines(
      cx, cy, state.sampleRate, a, e, anomMonth, apsidalDays,
      SOLAR_SYNODIC_ROTATION_DAYS, MOON_VIEW_JITTER_DAYS, MOON_VIEW_JITTER_PERIOD_DAYS,
    );
  } else if (pattern.geocentric) {
    state.linkLines = calculateGeocentricLines(
      cx, cy, state.sampleRate,
      state.currentOuterR, state.currentInnerR,
      state.currentOuterPeriod, state.currentInnerPeriod,
      state.currentSimYears,
      pattern.eccentricity1 ?? 0,
      pattern.precessionPeriodYears1 ?? 1000,
    );
  } else {
    state.linkLines = calculateEllipticalLines(
      cx, cy, state.sampleRate,
      pattern.planet1 ?? 'Earth', pattern.planet2 ?? 'Venus',
      state.currentSimYears, state.currentAuScale,
    );
  }
  state.fullLinkLines = state.linkLines;
  rebuildAllCaches(state, canvas);
}

// ── Shape management ─────────────────────────────────────────────────────────

/**
 * Re-bake a single probe's per-tick data after geometry changes, dispatching on
 * shape type: a sweeper re-casts its ray ticks; a discrete circle re-bins its
 * perimeter↔orbit crossings by angle (distance measured to the Sun = canvas
 * centre). Both write the same sweepTicks[arm][tick][slot] structure the
 * node-editor pipeline consumes.
 */
export function bakeShapeTicks(s: CanvasShape, state: AppState, canvas: HTMLCanvasElement): void {
  if (s.type === 'sweeper') {
    s.rebuildSweepTicks(state.linkLines, sweeperMaxR(s, state));
  } else if (s.type === 'circle') {
    s.bakeDiscreteTicks(state.linkLines, sunPos(canvas), state.orbitalMaxRadius);
  }
}

export function rebuildAllCaches(state: AppState, canvas: HTMLCanvasElement): void {
  for (const s of state.shapes) {
    s.rebuildIntersectionCache(state.linkLines);
    bakeShapeTicks(s, state, canvas);
  }
}

/**
 * Pick the lowest palette colour index not currently used by any live probe, so
 * no two probes on the canvas share a colour. Frees up colours after a probe is
 * deleted (the next spawn reclaims the gap). Once all palette slots are taken
 * (>8 concurrent probes) a repeat is unavoidable — fall back to the count.
 */
function nextColorIndex(state: AppState): number {
  const used = new Set(state.shapes.map(sh => sh.colorIndex));
  for (let i = 0; i < PROBE_PALETTE_SIZE; i++) {
    if (!used.has(i)) return i;
  }
  return state.shapes.length % PROBE_PALETTE_SIZE;
}

export function spawnShape(
  state: AppState,
  dom: DomElements,
  type: ShapeType,
  tour: TourController,
): void {
  const sun = sunPos(dom.canvas);
  let s: CanvasShape;
  if (type === 'circle') {
    // Discrete probe. Spawn CENTRED on the Sun — a clean ring whose orbital
    // crossings drive a morphing rhythm. A centred circle has a constant
    // perimeter→Sun distance, so its Distance→Pitch default is a single note
    // tuned by the radius (resize to retune); dragging it off-centre revives
    // melodic variation. Multiple circles fan by RADIUS into concentric rings
    // so they stay distinct and individually clickable.
    const n      = state.shapes.filter(sh => sh.type === 'circle').length;
    const radius = Math.min(150 + n * 60, MAX_SHAPE_SIZE);
    s = new CanvasShape(sun.x, sun.y, type, radius);
  } else {
    s = new CanvasShape(sun.x, sun.y, type, MAX_SHAPE_SIZE);
    // Auto-offset startAngle so each new sweeper's arm starts at a distinct angle.
    const existing = state.shapes.filter(sh => sh.type === 'sweeper');
    s.startAngle = (3 * Math.PI / 2 + existing.length * Math.PI / 4) % (Math.PI * 2);
  }
  // Distinct colour per probe, shared across types (circle + sweeper draw from
  // one palette) so a circle and a sweeper never collide on the same hue.
  s.colorIndex = nextColorIndex(state);
  state.shapes.push(s);
  s.rebuildIntersectionCache(state.linkLines);
  bakeShapeTicks(s, state, dom.canvas);
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
  state.drawAnimDurationMs = revealDurationMs(state.currentPattern.simYears);
  state.drawGuidedTimeFrac = GUIDED_PHASE_MS / state.drawAnimDurationMs;
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
  rebuildAllCaches(state, dom.canvas);

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

// ── Cardioid pattern helpers ─────────────────────────────────────────────────
// Toggle the visibility of #cardioid-controls based on whether the active
// pattern is the cardioid kind. Called from applyPattern() and the bootstrap.
function syncCardioidControlsVisibility(state: AppState, dom: DomElements): void {
  const isCardioid = state.currentPattern.kind === 'cardioid';
  dom.cardioidControlsEl.classList.toggle('hidden', !isCardioid);
  if (isCardioid && state.currentPattern.cardioid) {
    const c = state.currentPattern.cardioid;
    dom.cardioidNSliderMultiplier.value = String(c.multiplier);
    dom.cardioidMultiplierValueEl.textContent = String(c.multiplier);
  }
}

// Regenerate cardioid linkLines after an N or n slider change. Unlike
// applyPattern(), this does NOT clear existing shapes — it just refreshes
// the chord set, re-bakes sweeper caches, and re-evaluates Strudel. Shapes
// the user has spawned keep playing across the geometry change.
function regenerateCardioidLines(state: AppState, dom: DomElements): void {
  const pattern = state.currentPattern;
  if (pattern.kind !== 'cardioid' || !pattern.cardioid) return;

  const cx = dom.canvas.width / 2;
  const cy = dom.canvas.height / 2;
  state.fullLinkLines = calculateCardioidLines(
    cx, cy,
    state.sampleRate, pattern.cardioid.multiplier, pattern.cardioid.radius,
  );
  state.linkLines = state.fullLinkLines;
  state.currentOuterR = pattern.cardioid.radius;
  state.orbitalMaxRadius = pattern.cardioid.radius * 1.05;

  rebuildAllCaches(state, dom.canvas);

  patchHeader(dom.telemetryTextarea, pattern.name, state.shapes.length, state.sampleRate, state.cpm);
  const hasSweeper = rebuildSweeperPatterns(dom.telemetryTextarea, state.shapes, pattern.name, state.sampleRate, state.cpm);
  if (hasSweeper && state.audioInitialized) {
    playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
  }
  updateTelemetry(dom, state);
}

// ── Pattern application ──────────────────────────────────────────────────────
// Swaps the active planetary pattern: recomputes orbital radii, rebuilds link
// lines, clears existing shapes, and kicks off the draw-animation. Shared by
// the Start-Engine bootstrap (first pattern) and the P-hotkey picker.

function applyPattern(state: AppState, dom: DomElements, pattern: PlanetaryPattern): void {
  state.currentPattern = pattern;

  const minDim = Math.min(dom.canvas.width, dom.canvas.height);
  state.currentAuScale = computeAuScale(pattern, minDim);
  state.currentSimYears = pattern.simYears;

  const cx = dom.canvas.width / 2;
  const cy = dom.canvas.height / 2;

  if (pattern.kind === 'cardioid' && pattern.cardioid) {
    // Cardioid: no AU-based orbit; use the configured radius as the bounding circle.
    state.currentInnerR = 0;
    state.currentOuterR = pattern.cardioid.radius;
    state.currentInnerPeriod = 1;
    state.currentOuterPeriod = 1;
    state.orbitalMaxRadius = pattern.cardioid.radius * 1.05;

    state.fullLinkLines = calculateCardioidLines(
      cx, cy,
      state.sampleRate, pattern.cardioid.multiplier, pattern.cardioid.radius,
    );
  } else if (pattern.kind === 'moon-hexagon') {
    // Stroboscopic Moon hexagon: scale by the Moon's own apogee, sample once
    // per Sun-Earth-View (27.275 d). Sample rate = number of views drawn;
    // default to ~one full hexagon as the exploration starting point.
    const a = (pattern.au1 ?? 0.00257) * state.currentAuScale;
    const e = pattern.eccentricity1 ?? 0;
    state.currentInnerR = a;
    state.currentOuterR = a;
    state.currentInnerPeriod = pattern.period1 ?? 27.5545;
    state.currentOuterPeriod = pattern.period2 ?? 365.2422;
    state.orbitalMaxRadius = a * (1 + e) * 1.05;
    state.sampleRate = 600;

    const anomMonth = state.currentInnerPeriod;
    const apsidalDays = (pattern.precessionPeriodYears1 ?? 8.85) * 365.25;
    state.fullLinkLines = calculateMoonHexagonLines(
      cx, cy, state.sampleRate, a, e, anomMonth, apsidalDays,
      SOLAR_SYNODIC_ROTATION_DAYS, MOON_VIEW_JITTER_DAYS, MOON_VIEW_JITTER_PERIOD_DAYS,
    );
  } else {
    const au1 = Math.min(pattern.au1 ?? 1, pattern.au2 ?? 1);
    const au2 = Math.max(pattern.au1 ?? 1, pattern.au2 ?? 1);
    state.currentInnerR = au1 * state.currentAuScale;
    state.currentOuterR = au2 * state.currentAuScale;

    const p1 = pattern.period1 ?? 365.25;
    const p2 = pattern.period2 ?? 365.25;
    if ((pattern.au1 ?? 0) < (pattern.au2 ?? 0)) {
      state.currentInnerPeriod = p1;
      state.currentOuterPeriod = p2;
    } else {
      state.currentInnerPeriod = p2;
      state.currentOuterPeriod = p1;
    }
    state.orbitalMaxRadius = state.currentOuterR * 1.05;

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
        pattern.planet1 ?? 'Earth', pattern.planet2 ?? 'Venus',
        state.currentSimYears, state.currentAuScale,
      );
    }
  }
  state.linkLines = state.fullLinkLines;

  while (state.shapes.length > 0) state.shapes.pop();
  state.activeShape = null;
  state.flashCooldowns.clear();
  syncCardioidControlsVisibility(state, dom);
  updateTelemetry(dom, state);

  startDrawAnimation(state, dom);
}

// ── Pattern selector modal (P hotkey) ────────────────────────────────────────
// Three-pane picker: inner-planet column | live looping Preview | outer-planet
// column, plus a Special row for the two non-pair patterns. Parallel to the
// node editor — confirming a pattern swaps the active link-line field and
// re-runs the draw-animation. Previews never call applyPattern; only Confirm
// and the Special-row cards do.

// \u2500\u2500 Selector picker state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Transient pair selection while the selector is open. Re-seeded from the
// active pattern each time the selector opens; committed only on Confirm.
let pickerInner = 'Venus';
let pickerOuter = 'Earth';
let previewLoop: PreviewLoop | null = null;

// ── Timbre playground state (one global settings object; ADR 0003) ─────────
let playgroundSettings: PlaygroundSettings = loadSettings(localStorage);
let playgroundUnlocked =
  loadUnlocked(localStorage) ||
  new URLSearchParams(window.location.search).has('playground');
let previewNodalPoints: NodalPoint[] = [];
let previewResonance = { innerOrbits: 13, outerOrbits: 8 };

function chordEnabled(): boolean {
  return NODAL_CHORD_DEFAULT_ON || playgroundUnlocked;
}

const PREVIEW_CANVAS_SIZE = 280; // matches index.html width/height
/** Detection sampling density — finer than the drawn 400 for stable maxima. */
const NODAL_DETECT_SAMPLES = 1200;

function triggerPreviewChord(): void {
  if (!chordEnabled() || previewNodalPoints.length === 0) return;
  playNodalChord(
    previewNodalPoints, playgroundSettings, previewResonance,
    PREVIEW_CANVAS_SIZE / 2,
  );
}

function thumbLineColor(state: AppState): string {
  return state.currentTheme === 'dark'
    ? 'rgba(194, 118, 46, 0.4)'
    : 'rgba(92, 58, 33, 0.35)';
}

function showPatternSelector(state: AppState, dom: DomElements, tour: TourController): void {
  if (state.isPlaying) togglePlayback(state, dom);

  if (state.drawAnimActive) {
    // Complete — don't just abandon — an in-flight reveal: the field fills in,
    // the non-fading "Press Space to skip" toast is replaced by the auto-fading
    // "Pattern ready" one, and a first-run tour still gets scheduled.
    finishDrawAnimation(state, dom, tour);
  }

  // Seed the pair picker from the active pattern when it is a planet pair.
  const cur = state.currentPattern;
  if ((cur.kind ?? 'planet') === 'planet' && !cur.geocentric && cur.planet1 && cur.planet2) {
    pickerInner = cur.planet1;
    pickerOuter = cur.planet2;
  }

  if (previewLoop === null) {
    previewLoop = createPreviewLoop(dom.patternPreviewCanvas, () => thumbLineColor(state), {
      getNodalPoints: () => chordEnabled() ? previewNodalPoints : [],
      getGlow: () => chordGlow(),
      onDrawComplete: () => triggerPreviewChord(),
    });
  }

  renderPlanetColumns(state, dom);
  renderSpecialRow(state, dom, tour);
  updatePreviewPane(state, dom);

  // Playground drawer never auto-opens — even when unlocked, it re-opens
  // only via double-click on the preview.
  dom.playgroundDrawer.classList.add('hidden');

  dom.patternSelectorEl.classList.remove('hidden');
}

// One button per planet per column. Right column entries not strictly outside
// the picked inner planet's orbit are disabled.
function renderPlanetColumns(state: AppState, dom: DomElements): void {
  // Preserve focus across the re-render (buttons are recreated each time a
  // selection changes, which would otherwise drop keyboard focus).
  const focused = document.activeElement instanceof HTMLElement &&
    document.activeElement.classList.contains('planet-option')
    ? {
        text: document.activeElement.textContent,
        col: document.activeElement.closest('#pattern-inner-list') ? 'inner' : 'outer',
      }
    : null;

  dom.patternInnerListEl.innerHTML = '';
  dom.patternOuterListEl.innerHTML = '';

  for (const planet of PLANET_ORDER) {
    const innerBtn = document.createElement('button');
    innerBtn.type = 'button';
    innerBtn.className = 'planet-option';
    innerBtn.textContent = planet;
    innerBtn.disabled = planet === PLANET_ORDER[PLANET_ORDER.length - 1]; // Neptune has no outer partner
    if (planet === pickerInner) innerBtn.classList.add('active');
    innerBtn.setAttribute('role', 'radio');
    innerBtn.setAttribute('aria-checked', String(planet === pickerInner));
    innerBtn.addEventListener('click', () => {
      pickerInner = planet;
      // Keep the pair valid: outer must orbit farther out than inner.
      if (ELEMENTS[pickerOuter].a <= ELEMENTS[pickerInner].a) {
        pickerOuter = PLANET_ORDER[PLANET_ORDER.indexOf(planet) + 1];
      }
      renderPlanetColumns(state, dom);
      updatePreviewPane(state, dom);
    });
    dom.patternInnerListEl.appendChild(innerBtn);

    const outerBtn = document.createElement('button');
    outerBtn.type = 'button';
    outerBtn.className = 'planet-option';
    outerBtn.textContent = planet;
    outerBtn.disabled = ELEMENTS[planet].a <= ELEMENTS[pickerInner].a;
    if (planet === pickerOuter) outerBtn.classList.add('active');
    outerBtn.setAttribute('role', 'radio');
    outerBtn.setAttribute('aria-checked', String(planet === pickerOuter));
    outerBtn.addEventListener('click', () => {
      pickerOuter = planet;
      renderPlanetColumns(state, dom);
      updatePreviewPane(state, dom);
    });
    dom.patternOuterListEl.appendChild(outerBtn);
  }

  if (focused) {
    const list = focused.col === 'inner' ? dom.patternInnerListEl : dom.patternOuterListEl;
    const match = Array.from(list.querySelectorAll<HTMLButtonElement>('.planet-option'))
      .find(btn => btn.textContent === focused.text);
    match?.focus();
  }
}

function updatePreviewPane(state: AppState, dom: DomElements): void {
  const pattern = getPatternForPair(pickerInner, pickerOuter);
  previewLoop?.setPattern(pattern);
  stopNodalChord(0.1); // pair changed mid-chord — fade the old pair out
  previewNodalPoints = [];
  if (chordEnabled() && (pattern.kind ?? 'planet') === 'planet'
      && !pattern.geocentric && pattern.period1 && pattern.period2) {
    // Nodal Chord is planet-pair only: specials (cardioid, moon-hexagon)
    // have no consecutive-link-line envelope in the nodality.js sense.
    previewResonance = computeResonance(pattern.period1, pattern.period2);
    previewNodalPoints = findNodalPoints(
      computePatternLines(pattern, PREVIEW_CANVAS_SIZE, NODAL_DETECT_SAMPLES),
      PREVIEW_CANVAS_SIZE / 2, PREVIEW_CANVAS_SIZE / 2,
      pattern.petals, PREVIEW_CANVAS_SIZE,
    );
  }
  dom.patternPreviewName.textContent = pattern.name;
  dom.patternPreviewMeta.textContent =
    `${pattern.petals} petals \u00b7 ${pattern.simYears} yr cycle`;
  dom.patternConfirmBtn.disabled = pattern.id === state.currentPattern.id;
  dom.patternConfirmBtn.textContent = pattern.id === state.currentPattern.id
    ? 'Currently exploring'
    : 'Explore this pattern';
}

// The two curated non-pair patterns keep the old thumbnail-card treatment.
function renderSpecialRow(state: AppState, dom: DomElements, tour: TourController): void {
  dom.patternCardsEl.innerHTML = '';
  const specials = PATTERNS.filter(p => p.kind === 'moon-hexagon' || p.kind === 'cardioid');
  for (const pattern of specials) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pattern-card';
    if (pattern.id === state.currentPattern.id) card.classList.add('active');
    card.dataset['pattern'] = pattern.id;

    const thumb = renderPatternThumbnail(pattern, 120, thumbLineColor(state));
    thumb.className = 'pattern-thumb';
    card.appendChild(thumb);

    const label = document.createElement('span');
    label.className = 'pattern-card-planets';
    label.textContent = pattern.kind === 'cardioid'
      ? `Cardioid \u00b7 n=${pattern.cardioid?.multiplier ?? 2}`
      : pattern.name;
    card.appendChild(label);

    card.addEventListener('click', () => {
      tour.notify('pattern-confirmed');
      hidePatternSelector(dom);
      if (pattern.id !== state.currentPattern.id) applyPattern(state, dom, pattern);
    });
    dom.patternCardsEl.appendChild(card);
  }
}

function hidePatternSelector(dom: DomElements): void {
  previewLoop?.stop();
  stopNodalChord();
  dom.playgroundDrawer.classList.add('hidden');
  dom.patternSelectorEl.classList.add('hidden');
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
      // All probes (sweeper + circle) ride the AudioContext clock for arm/
      // playhead phase, so anchor every one to this start moment.
      s.sweepAudioRefTime = t;
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
      if (s.sweepAudioRefTime > 0) {
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
    if (state.currentPattern.kind === 'cardioid' && state.currentPattern.cardioid) {
      state.currentInnerR = 0;
      state.currentOuterR = state.currentPattern.cardioid.radius;
    } else {
      const au1 = state.currentPattern.au1 ?? 1;
      const au2 = state.currentPattern.au2 ?? 1;
      state.currentOuterR = Math.max(au1, au2) * state.currentAuScale;
      state.currentInnerR = Math.min(au1, au2) * state.currentAuScale;
    }
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
  const pat = patternFromId(snap.patternId);
  if (!pat) { showToast(dom, 'Unknown pattern: ' + snap.patternId); return; }

  // Set pattern without triggering the draw animation
  state.currentPattern = pat;
  const minDim = Math.min(dom.canvas.width, dom.canvas.height);
  state.currentAuScale = computeAuScale(pat, minDim);

  if (pat.kind === 'cardioid' && pat.cardioid) {
    state.currentInnerR = 0;
    state.currentOuterR = pat.cardioid.radius;
    state.currentInnerPeriod = 1;
    state.currentOuterPeriod = 1;
  } else {
    const auMin = Math.min(pat.au1 ?? 1, pat.au2 ?? 1);
    const auMax = Math.max(pat.au1 ?? 1, pat.au2 ?? 1);
    state.currentInnerR = auMin * state.currentAuScale;
    state.currentOuterR = auMax * state.currentAuScale;
    const p1 = pat.period1 ?? 365.25;
    const p2 = pat.period2 ?? 365.25;
    if ((pat.au1 ?? 0) < (pat.au2 ?? 0)) {
      state.currentInnerPeriod = p1;
      state.currentOuterPeriod = p2;
    } else {
      state.currentInnerPeriod = p2;
      state.currentOuterPeriod = p1;
    }
  }
  state.currentSimYears  = pat.simYears;
  state.orbitalMaxRadius = state.currentOuterR * 1.05;
  syncCardioidControlsVisibility(state, dom);

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
    bakeShapeTicks(s, state, dom.canvas);
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

// ── Engine bootstrap (shared by both overlay buttons) ────────────────────────
// Both entry paths initialize audio on the click gesture; "muted" only zeroes
// the master gain, so un-muting later needs no new gesture.
async function startEngine(state: AppState, dom: DomElements, muted: boolean): Promise<void> {
  try {
    const { initializeAudio } = await import('./audio');
    const replInstance = await initializeAudio();
    state.strudelRepl = replInstance;
    replInstance.setCps(state.cpm / 60);
    state.audioInitialized = true;
    // The button choice IS the session's mute preference — it deliberately
    // overwrites any persisted value; localStorage only drives the pre-init
    // toggle icon and the next visit's overlay state.
    state.muted = muted;
    setMuted(muted);
    saveMuted(localStorage, muted);
    updateMuteToggleVisual(state, dom);
    dom.audioOverlay.classList.add('hidden');
    updateTelemetry(dom, state);
    playLiveCode(state.strudelRepl, dom.telemetryTextarea.value, false);
    applyPattern(state, dom, PATTERNS[0]);
  } catch (err) {
    console.error('[audio] init failed:', err);
  }
}

function toggleMute(state: AppState, dom: DomElements): void {
  if (!state.audioInitialized) return;
  state.muted = !state.muted;
  setMuted(state.muted);
  saveMuted(localStorage, state.muted);
  updateMuteToggleVisual(state, dom);
}

function updateMuteToggleVisual(state: AppState, dom: DomElements): void {
  dom.muteToggleBtn.textContent = state.muted ? '\u{1F507}' : '\u{1F50A}';
  dom.muteToggleBtn.setAttribute('aria-pressed', String(state.muted));
  dom.muteToggleBtn.setAttribute('aria-label', state.muted ? 'Unmute sound' : 'Mute sound');
}

// ── Master event handler setup ───────────────────────────────────────────────

export function setupEventHandlers(
  state: AppState,
  dom: DomElements,
  tour: TourController,
): void {
  // Resize
  window.addEventListener('resize', () => handleResize(state, dom));

  // Start engine buttons — with sound, or muted
  dom.audioOverlay.querySelector('#start-engine-btn')
    ?.addEventListener('click', () => { void startEngine(state, dom, false); });
  dom.startMutedBtn.addEventListener('click', () => { void startEngine(state, dom, true); });

  // Persistent speaker toggle
  dom.muteToggleBtn.addEventListener('click', () => toggleMute(state, dom));

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

  // Pattern selector — confirm the picked pair. Confirming while the tour's
  // final step is showing completes the tour (see tour.notify).
  dom.patternConfirmBtn.addEventListener('click', () => {
    const pattern = getPatternForPair(pickerInner, pickerOuter);
    tour.notify('pattern-confirmed');
    hidePatternSelector(dom);
    if (pattern.id !== state.currentPattern.id) applyPattern(state, dom, pattern);
  });

  // ── Cardioid pattern controls ──────────────────────────────────────────────
  // The cardioid pattern reuses the existing sample-rate knob for N (point
  // count). Only the multiplier (n) gets a dedicated slider. Slider edits
  // mutate the active pattern's cardioid config in place, then regenerate
  // linkLines without wiping shapes — geometry morphs mid-playback.
  dom.cardioidNSliderMultiplier.addEventListener('input', () => {
    const pattern = state.currentPattern;
    if (pattern.kind !== 'cardioid' || !pattern.cardioid) return;
    pattern.cardioid.multiplier = clamp(parseInt(dom.cardioidNSliderMultiplier.value, 10), 1, 50);
    dom.cardioidMultiplierValueEl.textContent = String(pattern.cardioid.multiplier);
    regenerateCardioidLines(state, dom);
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
    // Discrete circles re-bin their crossings as they move — this is the
    // "drag → rhythm morphs" curiosity payoff. (Sweepers ray-cast per frame.)
    if (state.shapeDragTarget.type === 'circle') {
      bakeShapeTicks(state.shapeDragTarget, state, dom.canvas);
    }
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
      // A moved probe's baked ticks changed → regenerate its block and re-eval
      // so the audio follows the new geometry (circle rhythm morphs on drag).
      const hasProbe = rebuildSweeperPatterns(dom.telemetryTextarea, state.shapes, state.currentPattern.name, state.sampleRate, state.cpm);
      if (hasProbe && state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
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
      if (state.activeShape.type === 'circle') {
        // Discrete circle: wheel resizes the radius, re-bins crossings, and
        // re-emits the baked block — the rhythm morphs as the perimeter sweeps
        // across more/fewer orbits. (Triangle/rectangle resize stays quarantined.)
        state.activeShape.size = clamp(state.activeShape.size + (up ? +6 : -6), MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
        state.activeShape.rebuildIntersectionCache(state.linkLines);
        bakeShapeTicks(state.activeShape, state, dom.canvas);
        drawScene(dom.ctx, state);
        updateTelemetry(dom, state);
        if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      } else if (state.activeShape.type === 'sweeper') {
        // Sweeper: wheel rotates the 12 o'clock start angle by 1°.
        const step  = Math.PI / 180;
        const delta = up ? -step : step;
        state.activeShape.startAngle = ((state.activeShape.startAngle + delta) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        state.activeShape.rebuildSweepTicks(state.linkLines, sweeperMaxR(state.activeShape, state));
        drawScene(dom.ctx, state);
        updateTelemetry(dom, state);
        if (state.audioInitialized) playLiveCode(state.strudelRepl, dom.telemetryTextarea.value);
      }
    }
  }, { passive: false });

  // Dock — click-to-spawn probe cards. Each .shape-tile declares `data-shape`;
  // we spawn the matching probe type. The card selector was revived 2026-06-07
  // (Sonic Foundry section). Only the two live probes have cards; the N hotkey
  // still spawns a sweeper. Triangle/rectangle remain quarantined and are ignored.
  document.querySelectorAll<HTMLButtonElement>('.shape-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      const requested = tile.dataset['shape'] ?? 'sweeper';
      if (requested === 'circle')       spawnShape(state, dom, 'circle', tour);
      else if (requested === 'sweeper') spawnShape(state, dom, 'sweeper', tour);
      // else: quarantined shape type — no-op.
    });
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

  // Persistent keyboard shortcuts panel (src/keyboard-shortcuts.ts). Mounts the
  // left-edge panel and exposes toggle(). The ? button in the dock header and the
  // ? key (wired in the keydown handler below) both flip it expanded ⇄ collapsed.
  const keyboardShortcuts = initKeyboardShortcutsPanel();
  document.getElementById('keyboard-shortcuts-btn')
    ?.addEventListener('click', () => keyboardShortcuts.toggle());

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

    // '?' toggles the persistent keyboard shortcuts panel. e.key is already '?'
    // (Shift+/) so no modifier check is needed; gated above on text inputs so
    // typing ? in the live-code editor won't trigger it.
    if (e.key === '?') {
      e.preventDefault();
      keyboardShortcuts.toggle();
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'd':
        document.body.classList.toggle('ui-hidden');
        break;
      case 'i':
        toggleTelemetry(dom);
        break;
      case 'm':
        if (state.audioInitialized) toggleMute(state, dom);
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
          showPatternSelector(state, dom, tour);
          tour.notify('pattern-opened');
        } else {
          hidePatternSelector(dom);
        }
        break;
      case 'e': {
        // E toggle: close if open-for-same / no-active-probe, else (re)open for
        // the active probe (sweeper OR discrete circle). openEditor itself
        // no-ops back to closed when called with the id it's already showing.
        const active = state.activeShape;
        const probeId = active !== null ? active.id : null;
        if (probeId === null || probeId === currentSweeperId()) {
          if (isEditorOpen()) closeEditor();
        } else {
          e.preventDefault();
          openEditor(probeId);
          tour.notify('editor-opened');
        }
        break;
      }
    }
  });

  // ── Preview interactions: click replays the draw+chord; double-click is
  //    the hidden surprise — it unlocks and toggles the playground drawer. ──
  dom.patternPreviewCanvas.addEventListener('click', () => {
    previewLoop?.replay();
  });
  dom.patternPreviewCanvas.addEventListener('dblclick', () => {
    if (!playgroundUnlocked) {
      playgroundUnlocked = true;
      saveUnlocked(localStorage, true);
      updatePreviewPane(state, dom); // compute points now that we're unlocked
    }
    syncPlaygroundInputs(dom);
    dom.playgroundDrawer.classList.toggle('hidden');
  });

  // ── Playground knobs: mutate the one global settings object, persist,
  //    and retrigger the chord so every change is heard immediately. ──────
  function syncPlaygroundInputs(d: DomElements): void {
    d.pgOperator.value = playgroundSettings.operator;
    d.pgBalance.value = String(playgroundSettings.balance);
    d.pgPhase.value = String(playgroundSettings.phaseDeg);
    d.pgFmIndex.value = String(playgroundSettings.fmIndex);
    d.pgRatioMode.value = playgroundSettings.ratioMode;
    d.pgFreeRatio.value = String(playgroundSettings.freeRatio);
    d.pgF0.value = String(playgroundSettings.f0);
    d.pgWrap.checked = playgroundSettings.wrapOctave;
    d.pgRadiusMapping.value = playgroundSettings.radiusMapping;
    d.pgSustain.value = String(playgroundSettings.sustainMs);
    d.pgGain.value = String(playgroundSettings.gain);
  }

  function onKnobChange(mutate: (s: PlaygroundSettings) => void): void {
    mutate(playgroundSettings);
    saveSettings(localStorage, playgroundSettings);
    triggerPreviewChord();
  }

  dom.pgOperator.addEventListener('change', () =>
    onKnobChange(s => { s.operator = dom.pgOperator.value as PlaygroundSettings['operator']; }));
  dom.pgBalance.addEventListener('input', () =>
    onKnobChange(s => { s.balance = Number(dom.pgBalance.value); }));
  dom.pgPhase.addEventListener('input', () =>
    onKnobChange(s => { s.phaseDeg = Number(dom.pgPhase.value); }));
  dom.pgFmIndex.addEventListener('input', () =>
    onKnobChange(s => { s.fmIndex = Number(dom.pgFmIndex.value); }));
  dom.pgRatioMode.addEventListener('change', () =>
    onKnobChange(s => { s.ratioMode = dom.pgRatioMode.value as PlaygroundSettings['ratioMode']; }));
  dom.pgFreeRatio.addEventListener('input', () =>
    onKnobChange(s => { s.freeRatio = Number(dom.pgFreeRatio.value); }));
  dom.pgF0.addEventListener('input', () =>
    onKnobChange(s => { s.f0 = Number(dom.pgF0.value); }));
  dom.pgWrap.addEventListener('change', () =>
    onKnobChange(s => { s.wrapOctave = dom.pgWrap.checked; }));
  dom.pgRadiusMapping.addEventListener('change', () =>
    onKnobChange(s => { s.radiusMapping = dom.pgRadiusMapping.value as PlaygroundSettings['radiusMapping']; }));
  dom.pgSustain.addEventListener('input', () =>
    onKnobChange(s => { s.sustainMs = Number(dom.pgSustain.value); }));
  dom.pgGain.addEventListener('input', () =>
    onKnobChange(s => { s.gain = Number(dom.pgGain.value); }));

  dom.pgCopyCode.addEventListener('click', () => {
    void navigator.clipboard.writeText(settingsAsCode(playgroundSettings));
    dom.pgCopyCode.textContent = 'Copied!';
    setTimeout(() => { dom.pgCopyCode.textContent = 'Copy settings as code'; }, 1200);
  });

  // Initial visuals
  updateSampleKnobVisual(state, dom);
  updateCpmKnobVisual(state, dom);
  updateMuteToggleVisual(state, dom);
}

// ── Helper: anchor sweep phase before CPM change ─────────────────────────────

function anchorSweepPhase(state: AppState): void {
  if (!state.isPlaying || !state.audioInitialized) return;
  const acTime = getAudioTime();
  if (acTime <= 0) return;
  const cycleS_old = 60 / state.cpm;
  for (const s of state.shapes) {
    if (s.sweepAudioRefTime > 0) {
      s.sweepPhaseAtRef  = (s.sweepPhaseAtRef +
        (acTime - s.sweepAudioRefTime) / cycleS_old) % 1;
      s.sweepAudioRefTime = acTime;
    }
  }
}
