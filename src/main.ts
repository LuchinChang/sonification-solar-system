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
import { updateTelemetry, flashTelemBlock } from './telemetry';
import {
  setupEventHandlers, calculateLines,
  finishDrawAnimation, updateCaption,
} from './controls';

// ── Initialise ───────────────────────────────────────────────────────────────

const state = createInitialState();
const dom   = resolveDomElements();
const tour  = createTourController(dom);

// Populate dust particles (deferred from state — canvas is now sized)
initDust(state.dustMotes);

// Wire up all event handlers
setupEventHandlers(state, dom, tour);

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
      if (shape.type === 'sweeper') {
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
      } else {
        shape.stepPlayhead(dt, state.cpm, state.playbackMode);
        const triggered = shape.checkAndFireCollisions();
        if (triggered.length > 0) {
          for (const int of triggered) shape.triggerAt(int.x, int.y);
          flashTelemBlock(dom.evalStatusEl, state.flashCooldowns, shape.id, now);
        }
        shape.stepAnimations();
      }
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
