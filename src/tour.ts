// src/tour.ts
//
// First-time guided walkthrough — sweeper-only onboarding.
// Self-contained state machine with injected DOM elements.
//
// Unit 15: rewritten for the Max-MSP-style sweeper-editor overhaul.
// The five steps walk a new user through: spawn sweeper → open editor →
// connect a cable → hear it → done.

import type { DomElements } from './dom';

// ── Types ────────────────────────────────────────────────────────────────────

export type TourAction =
  | 'sweeper-spawned'
  | 'editor-opened'
  | 'cable-connected'
  | 'play-pressed';

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
    text: 'Press <kbd>N</kbd> (or click the sweeper icon in the dock) to place a sweeper.',
    trigger: 'action',
  },
  { // 1 — Open the editor
    target: () => document.body,
    text: 'Press <kbd>E</kbd> to open the sweeper\u2019s editor panel.',
    trigger: 'action',
  },
  { // 2 — Connect a cable
    target: () => document.getElementById('node-editor-panel'),
    text: 'Drag a cable from a data rule to a sound rule.',
    trigger: 'action',
  },
  { // 3 — Hear it
    target: () => document.getElementById('play-pause-btn'),
    text: 'Press <kbd>Space</kbd> (or Play) to hear the sound.',
    trigger: 'action',
  },
  { // 4 — Done
    target: () => document.body,
    text: 'Done \u2014 explore more.',
    trigger: 'gotit',
  },
];

// ── Tour controller ──────────────────────────────────────────────────────────

export interface TourController {
  start(): void;
  end(skipped?: boolean): void;
  notify(action: TourAction): void;
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
        liftTarget.style.zIndex = '96';
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
    showStep();
  }

  function notify(action: TourAction): void {
    if (!active) return;
    const idx = stepIdx;
    if (action === 'sweeper-spawned'  && idx === 0) advance();
    else if (action === 'editor-opened'   && idx === 1) advance();
    else if (action === 'cable-connected' && idx === 2) advance();
    else if (action === 'play-pressed'    && idx === 3) advance();
  }

  // Wire up tour UI buttons
  dom.tourSkip.addEventListener('click', () => end(true));
  dom.tourGotIt.addEventListener('click', () => {
    if (active) advance();
  });
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
    get isActive() { return active; },
    get currentStep() { return stepIdx; },
  };
}
