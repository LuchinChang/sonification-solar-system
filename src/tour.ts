// src/tour.ts
//
// First-time guided walkthrough — 11-step intro tour.
// Self-contained state machine with injected DOM elements.

import type { DomElements } from './dom';

// ── Types ────────────────────────────────────────────────────────────────────

export type TourAction =
  | 'dock-shown'
  | 'shape-spawned'
  | 'play-pressed'
  | 'eval-pressed'
  | 'telemetry-toggled';

interface TourStep {
  target: () => HTMLElement | null;
  text: string;
  trigger: 'action' | 'gotit' | 'auto';
  autoMs?: number;
}

// ── Step definitions ─────────────────────────────────────────────────────────

const TOUR_DONE_KEY = 'intro-tour-done';

const tourSteps: TourStep[] = [
  { // 0 — Show the dock
    target: () => document.body,
    text: 'Press <kbd>D</kbd> to reveal the control dock.',
    trigger: 'action',
  },
  { // 1 — Spawn a shape
    target: () => document.getElementById('foundry-shapes'),
    text: 'Click a shape in the dock to place it on the canvas.',
    trigger: 'action',
  },
  { // 2 — Press Play
    target: () => document.getElementById('play-pause-btn'),
    text: 'Press <kbd>Space</kbd> or click Play to hear your creation.',
    trigger: 'action',
  },
  { // 3 — Celebrate
    target: () => document.body,
    text: 'You made music from planetary orbits!',
    trigger: 'auto',
    autoMs: 2000,
  },
  { // 4 — Sync changes
    target: () => document.body,
    text: 'Press <kbd>⌘/Ctrl+Enter</kbd> to sync your changes. Look for the green flash — it confirms the sound has been updated!',
    trigger: 'action',
  },
  { // 5 — Listen to the change
    target: () => document.body,
    text: 'Listen to the difference!',
    trigger: 'auto',
    autoMs: 3000,
  },
  { // 6 — Live code panel
    target: () => document.getElementById('telemetry-panel'),
    text: 'Press <kbd>I</kbd> to open the live code panel. Watch how code changes as you add shapes — you can edit it directly!',
    trigger: 'action',
  },
  { // 7 — Done
    target: () => document.body,
    text: 'You\'re all set! Explore freely.',
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

      const liftTarget = target.closest('#foundry-panel, #telemetry-panel') as HTMLElement ?? target;
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
    if (action === 'dock-shown' && idx === 0) advance();
    else if (action === 'shape-spawned' && idx === 1) advance();
    else if (action === 'play-pressed' && idx === 2) advance();
    else if (action === 'eval-pressed' && idx === 4) advance();
    else if (action === 'telemetry-toggled' && idx === 6) advance();
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
