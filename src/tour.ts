// src/tour.ts
//
// First-time guided walkthrough — sweeper-only onboarding.
// Self-contained state machine with injected DOM elements.
//
// Unit 15: rewritten for the Max-MSP-style sweeper-editor overhaul.
// Task 6: tooltip lifted to a sibling of #intro-tour (z-index fix), added
// Back/Next navigation, and a new step for the pattern picker (P hotkey).
// The six steps walk a new user through: spawn sweeper → open editor →
// connect a cable → hear it → open the pattern picker → done.

import type { DomElements } from './dom';

// ── Types ────────────────────────────────────────────────────────────────────

export type TourAction =
  | 'sweeper-spawned'
  | 'editor-opened'
  | 'cable-connected'
  | 'play-pressed'
  | 'pattern-opened';

interface TourStep {
  target: () => HTMLElement | null;
  text: string;
  trigger: 'action' | 'gotit' | 'auto';
  autoMs?: number;
}

// ── Step definitions ─────────────────────────────────────────────────────────

const TOUR_DONE_KEY = 'intro-tour-done';

const tourSteps: TourStep[] = [
  { // 0 — Spawn a sweeper
    target: () => document.getElementById('foundry-shapes'),
    text: 'Click the <strong>Sweeper</strong> card in the Sonic Foundry dock below (or press <kbd>N</kbd>) to place a sweeper probe at the Sun.',
    trigger: 'action',
  },
  { // 1 — Open the editor
    target: () => document.body,
    text: 'Click the sweeper on the canvas (or press <kbd>E</kbd> while it\u2019s selected) to open its node editor.',
    trigger: 'action',
  },
  { // 2 — Connect a cable
    target: () => document.getElementById('node-editor-panel'),
    text: 'Drag a cable from a <strong>data node</strong>\u2019s output port to a <strong>sound node</strong>\u2019s input port. The mapping commits when the editor closes.',
    trigger: 'action',
  },
  { // 3 — Hear it
    target: () => document.getElementById('play-pause-btn'),
    text: 'Press <kbd>Space</kbd> (or the ▶ button in the top-left) to hear your mapping.',
    trigger: 'action',
  },
  { // 4 — Open the pattern picker
    target: () => document.body,
    text: 'Press <kbd>P</kbd> to open the pattern picker and choose your own pair of planets.',
    trigger: 'action',
  },
  { // 5 — Done
    target: () => document.getElementById('pattern-selector'),
    text: 'Pick an inner and an outer planet, watch the preview in the middle, then confirm. The Solar System is yours — explore.',
    trigger: 'gotit',
  },
];

// ── Tour controller ──────────────────────────────────────────────────────────

export interface TourController {
  start(): void;
  end(skipped?: boolean): void;
  notify(action: TourAction): void;
  back(): void;
  next(): void;
  readonly isActive: boolean;
  readonly currentStep: number;
}

export function createTourController(dom: DomElements): TourController {
  let active = false;
  let stepIdx = 0;
  let liftedEl: HTMLElement | null = null;

  function shouldShow(): boolean {
    if (new URLSearchParams(window.location.search).has('tour')) return true;
    return !localStorage.getItem(TOUR_DONE_KEY);
  }

  function showToast(msg: string): void {
    const toast = document.createElement('div');
    toast.id = 'intro-tour-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('fade-out'), 1500);
    setTimeout(() => toast.remove(), 2200);
  }

  function showStep(): void {
    const step = tourSteps[stepIdx];
    const target = step.target();

    // Restore previously lifted element
    if (liftedEl) {
      liftedEl.style.zIndex = '';
      liftedEl = null;
    }

    dom.tourCounter.textContent = `Step ${stepIdx + 1} of ${tourSteps.length}`;
    dom.tourText.innerHTML = step.text;

    if (step.trigger === 'gotit') {
      dom.tourGotIt.classList.remove('hidden');
    } else {
      dom.tourGotIt.classList.add('hidden');
    }

    dom.tourBack.disabled = stepIdx === 0;
    dom.tourNext.classList.toggle('hidden', step.trigger === 'gotit');

    // Position spotlight
    if (target && target !== document.body) {
      const rect = target.getBoundingClientRect();
      const pad = 8;
      dom.tourSpot.style.left   = `${rect.left - pad}px`;
      dom.tourSpot.style.top    = `${rect.top - pad}px`;
      dom.tourSpot.style.width  = `${rect.width + pad * 2}px`;
      dom.tourSpot.style.height = `${rect.height + pad * 2}px`;
      dom.tourSpot.style.display = 'block';

      const liftTarget = target.closest('#foundry-panel, #telemetry-panel, #node-editor-panel') as HTMLElement ?? target;
      if (step.trigger === 'action' || step.trigger === 'gotit') {
        liftTarget.style.zIndex = '171';
        liftedEl = liftTarget;
      }
    } else {
      dom.tourSpot.style.display = 'none';
    }

    // Auto-advance
    if (step.trigger === 'auto' && step.autoMs) {
      setTimeout(() => {
        if (active && stepIdx === tourSteps.indexOf(step)) advance();
      }, step.autoMs);
    }
  }

  function advance(): void {
    stepIdx++;
    if (stepIdx >= tourSteps.length) {
      end();
    } else {
      showStep();
    }
  }

  function end(skipped = false): void {
    active = false;
    dom.tourEl.classList.add('hidden');
    dom.tourTooltip.classList.add('hidden');
    if (liftedEl) {
      liftedEl.style.zIndex = '';
      liftedEl = null;
    }
    localStorage.setItem(TOUR_DONE_KEY, 'true');
    if (skipped) showToast('Tour skipped — add ?tour=1 to URL to replay');
  }

  function start(): void {
    if (!shouldShow()) return;
    active = true;
    stepIdx = 0;
    dom.tourEl.classList.remove('hidden');
    dom.tourTooltip.classList.remove('hidden');
    showStep();
  }

  function notify(action: TourAction): void {
    if (!active) return;
    const idx = stepIdx;
    if (action === 'sweeper-spawned'  && idx === 0) advance();
    else if (action === 'editor-opened'   && idx === 1) advance();
    else if (action === 'cable-connected' && idx === 2) advance();
    else if (action === 'play-pressed'    && idx === 3) advance();
    else if (action === 'pattern-opened'  && idx === 4) advance();
  }

  function back(): void {
    if (!active || stepIdx === 0) return;
    stepIdx--;
    showStep();
  }

  function next(): void {
    if (!active) return;
    advance();
  }

  // Wire up tour UI buttons
  dom.tourSkip.addEventListener('click', () => end(true));
  dom.tourGotIt.addEventListener('click', () => {
    if (active) advance();
  });
  dom.tourBack.addEventListener('click', back);
  dom.tourNext.addEventListener('click', next);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && active) {
      e.preventDefault();
      end(true);
    }
  });

  return {
    start,
    end,
    notify,
    back,
    next,
    get isActive() { return active; },
    get currentStep() { return stepIdx; },
  };
}
