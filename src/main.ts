// src/main.ts
//
// Thin orchestration entry point — wires together state, DOM, audio,
// rendering, controls, and tour modules. ~80 lines.

import './style.css';
import { getAudioContext } from '@strudel/webaudio';
import { createInitialState } from './state';
import { resolveDomElements } from './dom';
import { initDust } from './renderer';
import { drawScene } from './renderer';
import { setTheme } from './theme';
import { createTourController } from './tour';
// LEGACY: flashTelemBlock was only used in the non-sweeper rAF branch.
import { updateTelemetry } from './telemetry';
import {
  setupEventHandlers, calculateLines,
  finishDrawAnimation, updateCaption,
} from './controls';
import { initNodeEditor, openEditor } from './node-editor';

// ── Initialise ───────────────────────────────────────────────────────────────

const state = createInitialState();
const dom   = resolveDomElements();
const tour  = createTourController(dom);

// Populate dust particles (deferred from state — canvas is now sized)
initDust(state.dustMotes);

// Wire up all event handlers
setupEventHandlers(state, dom, tour);

// ── Node editor (Unit 4 scaffolding) ─────────────────────────────────────────
// Opens when a sweeper is clicked on the canvas, or when 'E' is pressed with a
// sweeper selected. Escape closes (handled inside panel.ts). Codegen is
// DEFERRED — Unit 14 will hook into closeEditor().
initNodeEditor({
  resolveSweeper: id => state.shapes.find(s => s.id === id && s.type === 'sweeper') ?? null,
});

// Canvas click → open editor for sweeper. This runs AFTER controls.ts's
// existing click handler (which selects the shape); both fire on the same
// click because we attach with addEventListener — order matches registration.
// The 'E' hotkey is owned by controls.ts (toggle semantics).
dom.canvas.addEventListener('click', e => {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (s.type === 'sweeper' && s.containsPoint(e.clientX, e.clientY)) {
      openEditor(s.id);
      tour.notify('editor-opened');
      return;
    }
  }
});

// Size canvas + compute initial link lines
dom.canvas.width  = window.innerWidth;
dom.canvas.height = window.innerHeight;
calculateLines(state, dom.canvas);

// Initial UI state
updateTelemetry(dom, state);
setTheme('light', dom.themeToggleBtn);

dom.playPauseBtn.textContent = state.isPlaying ? '⏸' : '▶';
dom.playPauseBtn.setAttribute('aria-label', state.isPlaying ? 'Pause playback' : 'Resume playback');
dom.playPauseBtn.classList.toggle('playing', state.isPlaying);

// ── Animation loop ───────────────────────────────────────────────────────────

function animate(now: number): void {
  let dt = 0;
  if (state.isPlaying && state.lastFrameTime > 0) {
    dt = Math.min(now - state.lastFrameTime, 100);
  }
  state.lastFrameTime = now;

  if (state.isPlaying && dt > 0) {
    for (const shape of state.shapes) {
      // Sweeper-only (Unit 1 quarantine): ShapeType is narrowed to 'sweeper'.
      // Drive sweeper arm from AudioContext clock — per-shape phase
      // (sweepAudioRefTime / sweepPhaseAtRef live on each CanvasShape so
      // multiple sweepers can run independently).
      try {
        if (state.audioInitialized && shape.sweepAudioRefTime > 0) {
          const cycleS = 60 / state.cpm;
          const phase  = (shape.sweepPhaseAtRef +
            (getAudioContext().currentTime - shape.sweepAudioRefTime) / cycleS) % 1;
          shape.prevPlayheadAngle = shape.playheadAngle;
          shape.playheadAngle     = (shape.startAngle + phase * Math.PI * 2) % (Math.PI * 2);
        } else {
          shape.stepPlayhead(dt, state.cpm, state.playbackMode);
        }
      } catch (e) {
        console.debug('[audio] AC clock fallback:', e);
        shape.stepPlayhead(dt, state.cpm, state.playbackMode);
      }
      shape.computeSweepClusters(state.linkLines, state.orbitalMaxRadius);
      // LEGACY: disabled 2026-04-21 — non-sweeper rAF branch (stepPlayhead +
      // checkAndFireCollisions + triggerAt + stepAnimations + telem flash).
      // Sweepers do not produce angle-crossing events; they use cluster signals.
      // To re-enable: un-comment this block and restore non-sweeper ShapeTypes.
      /*
      else {
        shape.stepPlayhead(dt, state.cpm, state.playbackMode);
        const triggered = shape.checkAndFireCollisions();
        if (triggered.length > 0) {
          for (const int of triggered) shape.triggerAt(int.x, int.y);
          flashTelemBlock(dom.evalStatusEl, state.flashCooldowns, shape.id, now);
        }
        shape.stepAnimations();
      }
      */
    }
  }

  // Progressive draw animation
  if (state.drawAnimActive) {
    const elapsed = now - state.drawAnimStartTime;
    state.drawAnimProgress = Math.min(elapsed / state.drawAnimDurationMs, 1);
    state.drawLineCount = Math.floor(state.drawAnimProgress * state.fullLinkLines.length);
    updateCaption(state, dom, state.drawAnimProgress);
    if (state.drawAnimProgress >= 1) finishDrawAnimation(state, dom, tour);
  }

  drawScene(dom.ctx, state);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
