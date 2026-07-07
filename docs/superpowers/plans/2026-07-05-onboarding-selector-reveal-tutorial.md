# Onboarding, Pattern Selector, Reveal & Tutorial Redo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four features decided in the 2026-07-05 grilling session: (1) a sound notice + sound-on/off choice on the start overlay plus a persistent mute toggle; (2) a two-phase educational **Reveal** (slow guided phase with visible planets, then accelerated completion); (3) a three-pane pattern selector (inner-planet column | live preview | outer-planet column, plus a Special row) backed by the hybrid Curated/Computed pattern model (ADR 0002); (4) a tutorial redo (z-index fix, Back/Next buttons, accurate step text, new pattern-picker step).

**Architecture:** Pure math goes in new leaf modules (`src/reveal.ts`, `src/pattern-generator.ts`, `src/pattern-preview.ts`, `src/mute.ts`) tested headlessly like `engine.ts`; DOM wiring stays in `controls.ts`/`tour.ts`/`index.html` per the existing math/render/audio separation. Domain vocabulary (Reveal, Preview, Curated/Computed Pattern, Inner/Outer Planet of a pair, Muted vs Paused) is already canonized in `CONTEXT.md`; the hybrid decision is recorded in `docs/adr/0002-hybrid-curated-computed-patterns.md`.

**Tech Stack:** TypeScript strict, Vite, Vitest (tests in `src/__tests__/*.test.ts`, node env with hand-rolled DOM mocks — see `tour.test.ts`), Canvas 2D, Strudel (`@strudel/core`, `@strudel/webaudio`).

**Key existing facts (verified against source):**
- Start overlay: `index.html:19-26` (`#audio-overlay`, `#start-engine-btn`), handler `src/controls.ts:693-707`. No mute control exists anywhere.
- Audio chain: `src/audio.ts:47-114` — `compressor.connect(ac.destination)` at line 60; a master gain must slot in between.
- Draw animation: `startDrawAnimation` `src/controls.ts:192-208` (duration `min(simYears*1500, 25000)`), progress loop `src/main.ts:203-209` (linear), progressive line draw `src/renderer.ts:98`.
- Line endpoints ARE planet positions: `calculateEllipticalLines` (`src/engine.ts:117-148`) pushes `p1` = planet1 (pattern's inner planet), `p2` = planet2.
- Planet periods derivable from JPL elements: `periodDays = (360 / ELEMENTS[key].LDot) * 36525` (`LDot` is deg/century; Mercury → 87.97 ✓).
- Pattern selector: `showPatternSelector` `src/controls.ts:385-425`, flat card grid; `selectPattern` looks up `PATTERNS.find(p => p.id === patternId)` — computed patterns break this and `restoreFromSnapshot` (`src/controls.ts:592`).
- `applyPattern` (`src/controls.ts:294-378`) clears all probes and starts the draw animation — previews must NEVER call it; only Confirm does.
- Tour z-index bug: `#intro-tour` z-95 / tooltip z-96 / targets lifted to '96' (`src/tour.ts:119`), but node-editor panel is z-**120**, its toolbox z-150/160 (`src/node-editor/styles.css:10,644,688`) — the editor paints over the tour tooltip on step 2. Fix: scrim container 170, lifted targets 171, tooltip (moved to a sibling element) 172.
- Tests: vitest `include: ['src/__tests__/**/*.test.ts']`, node environment; DOM-dependent modules are tested with mock objects (`tour.test.ts:47-103` mocks all `DomElements`).

**File map:**
- Create: `src/mute.ts`, `src/reveal.ts`, `src/pattern-generator.ts`, `src/pattern-preview.ts`
- Create: `src/__tests__/mute.test.ts`, `src/__tests__/reveal.test.ts`, `src/__tests__/pattern-generator.test.ts`, `src/__tests__/pattern-preview.test.ts`
- Modify: `index.html`, `src/audio.ts`, `src/controls.ts`, `src/dom.ts`, `src/state.ts`, `src/main.ts`, `src/renderer.ts`, `src/patterns.ts`, `src/tour.ts`, `src/style.css`, `src/keyboard-shortcuts.ts`, `src/__tests__/tour.test.ts`, `Progress.md`
- Do NOT touch: `src/node-editor/**` (except no files needed), `src/engine.ts` (read-only reuse), `src/shapes.ts`

---

### Task 1: Mute module + sound-notice overlay + persistent mute toggle

**Files:**
- Create: `src/mute.ts`, `src/__tests__/mute.test.ts`
- Modify: `src/audio.ts` (master gain), `index.html` (overlay copy, second start button, speaker button), `src/dom.ts`, `src/controls.ts` (startEngine refactor, toggle, M hotkey), `src/state.ts` (muted field), `src/keyboard-shortcuts.ts` (M row), `src/style.css`

- [ ] **Step 1.1: Write the failing test**

Create `src/__tests__/mute.test.ts`:

```ts
// src/__tests__/mute.test.ts
//
// Tests for the mute persistence helpers (pure — storage is injected).

import { describe, it, expect } from 'vitest';
import { MUTE_STORAGE_KEY, loadMuted, saveMuted } from '../mute';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  };
}

describe('mute persistence', () => {
  it('defaults to unmuted when nothing is stored', () => {
    expect(loadMuted(memoryStorage())).toBe(false);
  });

  it('round-trips muted=true', () => {
    const s = memoryStorage();
    saveMuted(s, true);
    expect(loadMuted(s)).toBe(true);
  });

  it('round-trips muted=false after true', () => {
    const s = memoryStorage();
    saveMuted(s, true);
    saveMuted(s, false);
    expect(loadMuted(s)).toBe(false);
  });

  it('uses a stable storage key', () => {
    expect(MUTE_STORAGE_KEY).toBe('sound-muted');
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/mute.test.ts`
Expected: FAIL — `Cannot find module '../mute'`

- [ ] **Step 1.3: Write minimal implementation**

Create `src/mute.ts`:

```ts
// src/mute.ts
//
// Muted ≠ Paused (see CONTEXT.md): muted keeps the engine running at zero
// volume; paused stops playback time. This module owns only the persisted
// muted *preference* — the actual gain change lives in audio.ts (setMuted).

export const MUTE_STORAGE_KEY = 'sound-muted';

export function loadMuted(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(MUTE_STORAGE_KEY) === 'true';
}

export function saveMuted(storage: Pick<Storage, 'setItem'>, muted: boolean): void {
  storage.setItem(MUTE_STORAGE_KEY, String(muted));
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/mute.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 1.5: Insert master mute gain into the audio chain**

In `src/audio.ts`, replace line 60 (`compressor.connect(ac.destination);`) with:

```ts
  // Master mute gain sits after the compressor. setMuted() flips it 0 ⇄ 1 so
  // "muted" silences output while Strudel keeps scheduling (Muted ≠ Paused).
  masterMuteGain = ac.createGain();
  masterMuteGain.gain.value = 1;
  masterMuteGain.connect(ac.destination);
  compressor.connect(masterMuteGain);
```

Add near the top of `src/audio.ts` (below the imports, above `resumeAudioContext`):

```ts
// ── Master mute ──────────────────────────────────────────────────────────────
let masterMuteGain: GainNode | null = null;

/** Silence (true) or restore (false) all audio output without stopping playback. */
export function setMuted(muted: boolean): void {
  if (masterMuteGain !== null) masterMuteGain.gain.value = muted ? 0 : 1;
}
```

Note: the `AudioNode.prototype.connect` monkey-patch (lines 62-70) reroutes `dest === ac.destination → compressor`; our `masterMuteGain.connect(ac.destination)` runs *before* the patch is installed, so it is unaffected. Do not reorder.

- [ ] **Step 1.6: Rework the overlay HTML + add the speaker toggle**

In `index.html`, replace the `#audio-overlay` block (lines 19-26) with:

```html
    <!-- ══ Audio-init overlay — sonification notice + sound choice.
         Browser policy requires a user gesture; BOTH buttons initialize the
         engine on click (the gesture is free at that moment) — "Start muted"
         just zeroes the master mute gain so un-muting later is instant. ══ -->
    <div id="audio-overlay">
      <div class="sound-notice">
        <span class="engine-icon" aria-hidden="true">&#x25C9;</span>
        <h1 class="sound-notice-title">Solar System Sonification</h1>
        <p class="sound-notice-text">
          This is a <strong>sonification</strong> app &mdash; planetary motions become
          <strong>sound</strong>. Audio will play through your speakers or headphones.
        </p>
      </div>
      <div class="start-choices">
        <button id="start-engine-btn" type="button">
          <span class="engine-label">Start with sound</span>
          <span class="engine-hint">Recommended &mdash; hear the orbits</span>
        </button>
        <button id="start-muted-btn" type="button">
          <span class="engine-label">Start muted</span>
          <span class="engine-hint">Explore silently &mdash; unmute anytime</span>
        </button>
      </div>
      <p class="signature">Solar System Sonification</p>
    </div>
```

In `index.html`, inside `#top-chrome` (after the `#theme-toggle` button, before `</aside>` at line 92), add:

```html
      <button
        id="mute-toggle"
        class="config-btn"
        aria-label="Mute sound"
        aria-pressed="false"
        title="Mute / Unmute  [ M ]"
      >&#x1F50A;</button>
```

- [ ] **Step 1.7: Register the new DOM elements**

In `src/dom.ts`, add to the `DomElements` interface (after `audioOverlay: HTMLElement;`):

```ts
  startMutedBtn: HTMLButtonElement;
  muteToggleBtn: HTMLButtonElement;
```

And in `resolveDomElements()` (after `audioOverlay: getEl('audio-overlay'),`):

```ts
    startMutedBtn: getEl('start-muted-btn') as HTMLButtonElement,
    muteToggleBtn: getEl('mute-toggle') as HTMLButtonElement,
```

**Consequence:** every test that mocks `DomElements` must gain these keys. In `src/__tests__/tour.test.ts` `mockDomElements()` return object, add:

```ts
    startMutedBtn: el() as unknown as HTMLButtonElement,
    muteToggleBtn: el() as unknown as HTMLButtonElement,
```

(Task 6 adds more keys to the same mock; if `controls.test.ts` or others mock `DomElements`, extend them identically — grep: `grep -l "DomElements" src/__tests__/*.ts`.)

- [ ] **Step 1.8: Add `muted` to AppState**

In `src/state.ts`: add to the `AppState` interface under `// Audio`:

```ts
  muted: boolean;
```

In `createInitialState()` under `// Audio` (guarded — vitest runs in node where `localStorage` may not exist):

```ts
    muted: typeof localStorage !== 'undefined' && loadMuted(localStorage),
```

(with `import { loadMuted } from './mute';` — reuse the leaf module rather than duplicating the key literal; corrected after Task 1 code review.)

- [ ] **Step 1.9: Refactor the start handler + wire mute in controls.ts**

In `src/controls.ts`:

Add imports: `setMuted` to the existing `./audio` import list, and a new import line `import { saveMuted } from './mute';`.

Add this module-level helper (above `setupEventHandlers`):

```ts
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
```

Replace the existing start-engine listener (`src/controls.ts:693-707`) with:

```ts
  // Start engine buttons — with sound, or muted
  dom.audioOverlay.querySelector('#start-engine-btn')
    ?.addEventListener('click', () => { void startEngine(state, dom, false); });
  dom.startMutedBtn.addEventListener('click', () => { void startEngine(state, dom, true); });

  // Persistent speaker toggle
  dom.muteToggleBtn.addEventListener('click', () => toggleMute(state, dom));
```

In the keydown `switch` (after `case 'i':`), add:

```ts
      case 'm':
        if (state.audioInitialized) toggleMute(state, dom);
        break;
```

At the end of `setupEventHandlers` (next to `updateSampleKnobVisual`/`updateCpmKnobVisual` initial calls), add:

```ts
  updateMuteToggleVisual(state, dom);
```

- [ ] **Step 1.10: Document the M hotkey**

In `src/keyboard-shortcuts.ts`, `Global` section `bindings`, after the `Space` entry add:

```ts
      { keys: ['M'], label: 'Mute / Unmute' },
```

- [ ] **Step 1.11: Style the overlay**

In `src/style.css`, after the existing `#start-engine-btn` rules (~line 1130), add:

```css
/* Sound notice + two-choice start (2026-07-05 onboarding rework) */
.sound-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 440px;
  text-align: center;
  margin-bottom: 28px;
}
.sound-notice-title {
  font: 500 20px var(--font-mono);
  color: var(--text-primary);
  letter-spacing: 0.04em;
}
.sound-notice-text {
  font: 400 13px/1.6 var(--font-mono);
  color: var(--text-secondary);
}
.sound-notice-text strong { color: var(--accent-amber); }
.start-choices {
  display: flex;
  gap: 16px;
}
#start-muted-btn {
  /* Secondary variant of #start-engine-btn — same glass, dimmer accent */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 28px;
  border-radius: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  cursor: pointer;
}
#start-muted-btn:hover { border-color: var(--accent-copper); }
```

(Check the existing `#start-engine-btn` block first: if it sets `flex-direction`/`gap` on the button, keep those rules working with the new inner spans; the button no longer contains `.engine-icon`, which moved into `.sound-notice`.)

- [ ] **Step 1.12: Type-check + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean compile; all suites pass (mute.test.ts adds 4).

- [ ] **Step 1.13: Commit**

```bash
git add src/mute.ts src/__tests__/mute.test.ts src/audio.ts index.html src/dom.ts src/state.ts src/controls.ts src/keyboard-shortcuts.ts src/style.css src/__tests__/tour.test.ts
git commit -m "feat(onboarding): sound notice + start-muted choice + persistent mute toggle"
```

---

### Task 2: Reveal math module (pure)

**Files:**
- Create: `src/reveal.ts`, `src/__tests__/reveal.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/__tests__/reveal.test.ts`:

```ts
// src/__tests__/reveal.test.ts
//
// Tests for the two-phase Reveal timing math (see CONTEXT.md "Reveal"):
// a slow guided phase revealing GUIDED_LINE_FRACTION of the lines, then an
// accelerating completion phase.

import { describe, it, expect } from 'vitest';
import {
  GUIDED_PHASE_MS, GUIDED_LINE_FRACTION, MIN_REVEAL_MS,
  revealDurationMs, revealLineFraction, planetDiscAlpha,
} from '../reveal';

describe('revealDurationMs', () => {
  it('keeps the legacy formula for long patterns (simYears*1500 capped at 25s)', () => {
    expect(revealDurationMs(84)).toBe(25000);
    expect(revealDurationMs(12)).toBe(18000);
  });

  it('never returns less than the guided phase plus a completion window', () => {
    expect(revealDurationMs(1)).toBe(MIN_REVEAL_MS);
    expect(MIN_REVEAL_MS).toBeGreaterThan(GUIDED_PHASE_MS);
  });
});

describe('revealLineFraction', () => {
  const gf = GUIDED_PHASE_MS / revealDurationMs(8); // venus-earth: 12000ms total

  it('is 0 at the start and 1 at the end', () => {
    expect(revealLineFraction(0, gf)).toBe(0);
    expect(revealLineFraction(1, gf)).toBeCloseTo(1, 10);
  });

  it('reveals exactly GUIDED_LINE_FRACTION at the guided/completion boundary', () => {
    expect(revealLineFraction(gf, gf)).toBeCloseTo(GUIDED_LINE_FRACTION, 10);
  });

  it('is linear (slow) inside the guided phase', () => {
    expect(revealLineFraction(gf / 2, gf)).toBeCloseTo(GUIDED_LINE_FRACTION / 2, 10);
  });

  it('is monotonically non-decreasing across the whole timeline', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = revealLineFraction(Math.min(t, 1), gf);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('accelerates in the completion phase (second half reveals more than first half)', () => {
    const mid = gf + (1 - gf) / 2;
    const firstHalf = revealLineFraction(mid, gf) - revealLineFraction(gf, gf);
    const secondHalf = revealLineFraction(1, gf) - revealLineFraction(mid, gf);
    expect(secondHalf).toBeGreaterThan(firstHalf);
  });
});

describe('planetDiscAlpha', () => {
  const gf = 0.5;

  it('is fully opaque through the guided phase', () => {
    expect(planetDiscAlpha(0, gf)).toBe(1);
    expect(planetDiscAlpha(gf, gf)).toBe(1);
  });

  it('fades to 0 within the completion phase and stays there', () => {
    expect(planetDiscAlpha(1, gf)).toBe(0);
    const justAfter = planetDiscAlpha(gf + 0.01, gf);
    expect(justAfter).toBeLessThan(1);
    expect(justAfter).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/reveal.test.ts`
Expected: FAIL — `Cannot find module '../reveal'`

- [ ] **Step 2.3: Write the implementation**

Create `src/reveal.ts`:

```ts
// src/reveal.ts
//
// Reveal timing math (pure — no DOM). The Reveal is the one-time educational
// drawing of a newly applied pattern (CONTEXT.md): a slow GUIDED phase where
// the planet bodies visibly stamp each link line, then an accelerating
// COMPLETION phase where the figure finishes and the planet discs fade out.
//
// All functions take tFrac = elapsed/duration (0..1, the same value stored in
// state.drawAnimProgress) and guidedTimeFrac = GUIDED_PHASE_MS/durationMs.
// Captions stay keyed on tFrac, so authored caption timings are unaffected.

/** Wall-clock length of the guided phase. */
export const GUIDED_PHASE_MS = 7000;

/** Fraction of the pattern's lines revealed during the guided phase. */
export const GUIDED_LINE_FRACTION = 0.12;

/** Portion of the completion phase over which the planet discs fade out. */
export const PLANET_FADE_FRACTION = 0.2;

/** Reveals shorter than this can't fit a guided phase + a visible completion. */
export const MIN_REVEAL_MS = GUIDED_PHASE_MS + 4000;

/** Total Reveal duration: legacy formula with a floor for very short patterns. */
export function revealDurationMs(simYears: number): number {
  return Math.max(Math.min(simYears * 1500, 25000), MIN_REVEAL_MS);
}

/**
 * Fraction of lines to draw at time-fraction tFrac.
 * Guided phase: linear crawl to GUIDED_LINE_FRACTION.
 * Completion phase: quadratic ease-in over the remaining lines (starts slow,
 * accelerates — the deliberate "then it speeds up" beat).
 */
export function revealLineFraction(tFrac: number, guidedTimeFrac: number): number {
  if (guidedTimeFrac <= 0 || guidedTimeFrac >= 1) return Math.min(Math.max(tFrac, 0), 1);
  if (tFrac <= guidedTimeFrac) {
    return (tFrac / guidedTimeFrac) * GUIDED_LINE_FRACTION;
  }
  const u = (tFrac - guidedTimeFrac) / (1 - guidedTimeFrac);
  return GUIDED_LINE_FRACTION + (1 - GUIDED_LINE_FRACTION) * u * u;
}

/** Planet-disc opacity: 1 through the guided phase, fading out early in completion. */
export function planetDiscAlpha(tFrac: number, guidedTimeFrac: number): number {
  if (tFrac <= guidedTimeFrac) return 1;
  const u = (tFrac - guidedTimeFrac) / (1 - guidedTimeFrac);
  return Math.max(0, 1 - u / PLANET_FADE_FRACTION);
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/reveal.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 2.5: Commit**

```bash
git add src/reveal.ts src/__tests__/reveal.test.ts
git commit -m "feat(reveal): pure two-phase reveal timing math (guided crawl + eased completion)"
```

---

### Task 3: Wire the Reveal into controls / main / renderer

**Files:**
- Modify: `src/state.ts` (guided fraction field), `src/controls.ts` (startDrawAnimation), `src/main.ts` (progress mapping), `src/renderer.ts` (planet discs + live chord)

- [ ] **Step 3.1: Add reveal state**

In `src/state.ts` `AppState`, under `// Draw animation`, add:

```ts
  /** GUIDED_PHASE_MS / drawAnimDurationMs — precomputed for the render loop. */
  drawGuidedTimeFrac: number;
```

In `createInitialState()` under `// Draw animation`:

```ts
    drawGuidedTimeFrac: 0,
```

- [ ] **Step 3.2: Compute duration + guided fraction in startDrawAnimation**

In `src/controls.ts`, add import: `import { revealDurationMs, GUIDED_PHASE_MS } from './reveal';`

In `startDrawAnimation` (line 192), replace:

```ts
  state.drawAnimDurationMs = Math.min(state.currentPattern.simYears * 1500, 25000);
```

with:

```ts
  state.drawAnimDurationMs = revealDurationMs(state.currentPattern.simYears);
  state.drawGuidedTimeFrac = GUIDED_PHASE_MS / state.drawAnimDurationMs;
```

- [ ] **Step 3.3: Map time to lines through the reveal curve in main.ts**

In `src/main.ts`, add import: `import { revealLineFraction } from './reveal';`

Replace the progressive-draw block (lines 203-209):

```ts
  // Progressive draw animation
  if (state.drawAnimActive) {
    const elapsed = now - state.drawAnimStartTime;
    state.drawAnimProgress = Math.min(elapsed / state.drawAnimDurationMs, 1);
    state.drawLineCount = Math.floor(state.drawAnimProgress * state.fullLinkLines.length);
    updateCaption(state, dom, state.drawAnimProgress);
    if (state.drawAnimProgress >= 1) finishDrawAnimation(state, dom, tour);
  }
```

with:

```ts
  // Progressive Reveal: slow guided phase, then accelerating completion.
  // drawAnimProgress stays a TIME fraction (captions key on it); the line
  // count runs through the reveal curve.
  if (state.drawAnimActive) {
    const elapsed = now - state.drawAnimStartTime;
    state.drawAnimProgress = Math.min(elapsed / state.drawAnimDurationMs, 1);
    state.drawLineCount = Math.floor(
      revealLineFraction(state.drawAnimProgress, state.drawGuidedTimeFrac)
      * state.fullLinkLines.length,
    );
    updateCaption(state, dom, state.drawAnimProgress);
    if (state.drawAnimProgress >= 1) finishDrawAnimation(state, dom, tour);
  }
```

- [ ] **Step 3.4: Draw the planet discs + live chord in renderer.ts**

In `src/renderer.ts`, add import: `import { planetDiscAlpha } from './reveal';`

Insert immediately after the orbital-link-lines loop (after line 105, before the moon-hexagon block):

```ts
  // Reveal guided phase: draw the two planet bodies at the newest revealed
  // line's endpoints, with a bright live chord between them — making the CAUSE
  // of each link line visible. calculateEllipticalLines orders every line as
  // p1 = planet1 (the pair's inner planet), p2 = planet2 (outer). Planet-pair
  // patterns only: moon-hexagon lines are a polyline of Moon positions and the
  // cardioid has no bodies at all.
  const isPlanetPair =
    (state.currentPattern.kind ?? 'planet') === 'planet' && !state.currentPattern.geocentric;
  if (state.drawAnimActive && isPlanetPair && state.drawLineCount > 0) {
    const alpha = planetDiscAlpha(state.drawAnimProgress, state.drawGuidedTimeFrac);
    if (alpha > 0) {
      const newest = state.linkLines[Math.min(state.drawLineCount, state.linkLines.length) - 1];
      const isDark = state.currentTheme === 'dark';

      ctx.save();
      ctx.globalAlpha = alpha;

      // Live chord — brighter than the settled lines behind it
      ctx.strokeStyle = isDark ? 'rgba(255, 190, 100, 0.9)' : 'rgba(140, 80, 30, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(newest.p1.x, newest.p1.y);
      ctx.lineTo(newest.p2.x, newest.p2.y);
      ctx.stroke();

      const disc = (p: { x: number; y: number }, label: string) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#FFB870' : '#8C501E';
        ctx.fill();
        ctx.font = '500 11px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = isDark ? 'rgba(255, 220, 180, 0.95)' : 'rgba(70, 40, 15, 0.95)';
        ctx.fillText(label, p.x + 10, p.y);
      };
      disc(newest.p1, state.currentPattern.planet1 ?? '');
      disc(newest.p2, state.currentPattern.planet2 ?? '');
      ctx.restore();
    }
  }
```

- [ ] **Step 3.5: Type-check + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. (If `state.test.ts` or `renderer.test.ts` construct `AppState` literals rather than calling `createInitialState()`, add `drawGuidedTimeFrac: 0` and `muted: false` to those literals.)

- [ ] **Step 3.6: Visual verification**

Start the preview server (launch config name `sonification-solar-system`), click "Start with sound", and confirm: Venus and Earth discs + labels crawl along their orbits for ~7s stamping lines with a bright chord, captions play, then the figure accelerates to completion and the discs fade. Press Space mid-reveal → skips to the finished figure (existing `finishDrawAnimation` path — unchanged).

- [ ] **Step 3.7: Commit**

```bash
git add src/state.ts src/controls.ts src/main.ts src/renderer.ts
git commit -m "feat(reveal): two-phase educational reveal with visible planets and live chord"
```

---

### Task 4: Pattern generator — hybrid Curated/Computed model (ADR 0002)

**Files:**
- Create: `src/pattern-generator.ts`, `src/__tests__/pattern-generator.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `src/__tests__/pattern-generator.test.ts`:

```ts
// src/__tests__/pattern-generator.test.ts
//
// Hybrid pattern model (ADR 0002): any valid inner/outer pair yields a
// pattern — curated pairs return the authored catalogue entry, everything
// else is computed from JPL orbital elements.

import { describe, it, expect } from 'vitest';
import {
  PLANET_ORDER, periodDays, computeResonance,
  getPatternForPair, pairId, patternFromId,
} from '../pattern-generator';
import { PATTERNS } from '../patterns';

describe('periodDays', () => {
  it('derives sidereal periods from JPL LDot (deg/century)', () => {
    expect(periodDays('Mercury')).toBeCloseTo(87.97, 1);
    expect(periodDays('Earth')).toBeCloseTo(365.25, 0);
    expect(periodDays('Neptune')).toBeCloseTo(60190, -2);
  });
});

describe('computeResonance', () => {
  it('finds the Venus-Earth 13:8 resonance (5 petals over 8 years)', () => {
    const r = computeResonance(periodDays('Venus'), periodDays('Earth'));
    expect(r.outerOrbits).toBe(8);
    expect(r.innerOrbits).toBe(13);
    expect(r.petals).toBe(5);
    expect(r.simYears).toBeCloseTo(8, 0);
  });

  it('finds the Earth-Mars 15:8 resonance (7 petals ≈ curated Flower of Mars)', () => {
    const r = computeResonance(periodDays('Earth'), periodDays('Mars'));
    expect(r.petals).toBe(7);
    expect(r.simYears).toBeCloseTo(15, 0);
  });
});

describe('getPatternForPair', () => {
  it('returns the curated catalogue object for a curated pair', () => {
    const p = getPatternForPair('Venus', 'Earth');
    expect(p).toBe(PATTERNS.find(x => x.id === 'venus-earth'));
  });

  it('computes a pattern for an uncurated pair', () => {
    const p = getPatternForPair('Mars', 'Saturn');
    expect(p.id).toBe('pair-mars-saturn');
    expect(p.planet1).toBe('Mars');
    expect(p.planet2).toBe('Saturn');
    expect(p.au1).toBeCloseTo(1.524, 2);
    expect(p.au2).toBeCloseTo(9.537, 2);
    expect(p.simYears).toBeGreaterThan(0);
    expect(p.petals).toBeGreaterThan(0);
    expect(p.captions.length).toBeGreaterThanOrEqual(4);
    expect(p.captions[0].atProgress).toBe(0);
  });

  it('rejects a pair where the "inner" planet is not inside the outer orbit', () => {
    expect(() => getPatternForPair('Earth', 'Venus')).toThrow();
    expect(() => getPatternForPair('Earth', 'Earth')).toThrow();
  });

  it('rejects unknown planet names', () => {
    expect(() => getPatternForPair('Pluto', 'Neptune')).toThrow();
  });
});

describe('patternFromId', () => {
  it('resolves catalogue ids', () => {
    expect(patternFromId('venus-earth')?.name).toBe('Pentagram of Venus');
    expect(patternFromId('cardioid')?.kind).toBe('cardioid');
  });

  it('round-trips computed pair ids (config-snapshot restore path)', () => {
    const original = getPatternForPair('Mercury', 'Jupiter');
    const restored = patternFromId(pairId('Mercury', 'Jupiter'));
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(original.id);
    expect(restored!.simYears).toBe(original.simYears);
  });

  it('returns null for garbage ids', () => {
    expect(patternFromId('pair-foo-bar')).toBeNull();
    expect(patternFromId('nope')).toBeNull();
  });
});

describe('PLANET_ORDER', () => {
  it('lists all 8 planets sorted by semi-major axis', () => {
    expect(PLANET_ORDER).toEqual([
      'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
    ]);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/pattern-generator.test.ts`
Expected: FAIL — `Cannot find module '../pattern-generator'`

- [ ] **Step 4.3: Write the implementation**

Create `src/pattern-generator.ts`:

```ts
// src/pattern-generator.ts
//
// Hybrid Curated/Computed pattern model — see ADR 0002 and CONTEXT.md.
// Any valid inner/outer planet pair produces a playable pattern: pairs that
// match the authored catalogue return the Curated Pattern (name, tuned
// simYears, caption script); every other pair gets a Computed Pattern derived
// from JPL orbital elements. Pure module — no DOM.

import { ELEMENTS } from './orbital-elements';
import { PATTERNS, type PlanetaryPattern, type PatternCaption } from './patterns';

/** All 8 planets, sorted by semi-major axis (the selector's column order). */
export const PLANET_ORDER: readonly string[] = [
  'Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune',
];

/** Sidereal period in days from the JPL mean-longitude rate (deg/century). */
export function periodDays(planetKey: string): number {
  const el = ELEMENTS[planetKey];
  if (!el) throw new Error(`Unknown planet: ${planetKey}`);
  return (360 / el.LDot) * 36525;
}

export interface PairResonance {
  innerOrbits: number;  // k — orbits the inner planet completes
  outerOrbits: number;  // m — orbits the outer planet completes
  simYears: number;     // m outer periods, in years
  petals: number;       // k − m, the flower's petal count
}

/** Search cap: how many outer-planet orbits we're willing to wait for closure. */
export const MAX_OUTER_ORBITS = 20;
/** An m:k pair closer than this (relative error per outer orbit) is "closed". */
export const RESONANCE_TOLERANCE = 0.02;

/**
 * Find the smallest near-resonance m:k ≈ 1 : Pout/Pin. Takes the first m whose
 * rounding error is inside tolerance (favouring short, watchable cycles);
 * falls back to the best error found if nothing closes within the cap.
 */
export function computeResonance(periodInnerDays: number, periodOuterDays: number): PairResonance {
  const ratio = periodOuterDays / periodInnerDays;
  let best = { m: 1, k: Math.max(2, Math.round(ratio)), err: Infinity };
  for (let m = 1; m <= MAX_OUTER_ORBITS; m++) {
    const k = Math.round(m * ratio);
    if (k <= m) continue;
    const err = Math.abs(m * ratio - k) / m;
    if (err < RESONANCE_TOLERANCE) { best = { m, k, err }; break; }
    if (err < best.err) best = { m, k, err };
  }
  const rawYears = (best.m * periodOuterDays) / 365.25;
  const simYears = Math.round(Math.min(Math.max(rawYears, 1), 100) * 100) / 100;
  return { innerOrbits: best.k, outerOrbits: best.m, simYears, petals: best.k - best.m };
}

function computedCaptions(inner: string, outer: string, r: PairResonance): PatternCaption[] {
  return [
    { atProgress: 0.00, text: `${inner} and ${outer} begin their dance...`, duration: 4 },
    { atProgress: 0.15, text: 'A line connects the two planets at each moment in time.', duration: 5 },
    { atProgress: 0.35, text: `${inner} completes ${r.innerOrbits} orbits while ${outer} completes ${r.outerOrbits}.`, duration: 5 },
    { atProgress: 0.60, text: `Together they trace a ${r.petals}-petaled figure.`, duration: 5 },
    { atProgress: 0.97, text: 'The pattern is complete. The canvas is yours.', duration: 3 },
  ];
}

/** Stable id for a computed pair — parseable back by patternFromId. */
export function pairId(inner: string, outer: string): string {
  return `pair-${inner.toLowerCase()}-${outer.toLowerCase()}`;
}

/**
 * Resolve a planet pair to its Pattern. Curated pairs return the catalogue
 * object itself (identity matters: applyPattern compares ids); all other
 * valid pairs get a freshly computed pattern.
 */
export function getPatternForPair(inner: string, outer: string): PlanetaryPattern {
  const aIn = ELEMENTS[inner]?.a;
  const aOut = ELEMENTS[outer]?.a;
  if (aIn === undefined) throw new Error(`Unknown planet: ${inner}`);
  if (aOut === undefined) throw new Error(`Unknown planet: ${outer}`);
  if (aIn >= aOut) throw new Error(`${inner} is not inside ${outer}'s orbit`);

  const curated = PATTERNS.find(p =>
    (p.kind ?? 'planet') === 'planet' && !p.geocentric
    && p.planet1 === inner && p.planet2 === outer);
  if (curated) return curated;

  const pIn = periodDays(inner);
  const pOut = periodDays(outer);
  const res = computeResonance(pIn, pOut);
  return {
    id: pairId(inner, outer),
    name: `${inner} – ${outer}`,
    planet1: inner,
    planet2: outer,
    au1: aIn,
    au2: aOut,
    period1: pIn,
    period2: pOut,
    simYears: res.simYears,
    petals: res.petals,
    captions: computedCaptions(inner, outer, res),
  };
}

/**
 * Resolve any pattern id — catalogue or computed pair — used by the config
 * snapshot restore path so saved computed patterns reload.
 */
export function patternFromId(id: string): PlanetaryPattern | null {
  const catalogued = PATTERNS.find(p => p.id === id);
  if (catalogued) return catalogued;
  const m = /^pair-([a-z]+)-([a-z]+)$/.exec(id);
  if (!m) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  try {
    return getPatternForPair(cap(m[1]), cap(m[2]));
  } catch {
    return null;
  }
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/pattern-generator.test.ts`
Expected: PASS. If the Earth-Mars resonance assertion fails, print the actual result (`console.log(computeResonance(periodDays('Earth'), periodDays('Mars')))`) — the accepted m must give petals 7; adjust `RESONANCE_TOLERANCE` only if the found resonance is objectively wrong, not to force-fit the test.

- [ ] **Step 4.4b (amendment, post-review): duration-bounded resonance search**

The original `computeResonance` clamped `simYears` to 100 *after* an unbounded search, which silently falsified the computed captions for 16 of 28 pairs (e.g. Mercury-Neptune: petals 3416, rawYears 824 clamped to 100 — the figure never closes in the sim). Fix: bound the search itself — `mMax = max(1, min(MAX_OUTER_ORBITS, floor(MAX_SIM_YEARS / outerYears)))` — and never clamp the resulting `simYears` down (a single outer orbit may legitimately exceed 100 years; Neptune pairs run ~165y of sim time, still capped at 25s of wall-clock by the reveal). Resonance, duration, petals, and captions then always agree. Add documenting tests: Mercury-Neptune (m=1, simYears ≈ 164.8, truthful captions) and computed Jupiter-Uranus (m=1, 6 petals ≈ the curated answer).

- [ ] **Step 4.5: Commit**

```bash
git add src/pattern-generator.ts src/__tests__/pattern-generator.test.ts
git commit -m "feat(patterns): hybrid curated/computed pattern generator (ADR 0002)"
```

---

### Task 5: Three-pane pattern selector with live Preview

**Files:**
- Create: `src/pattern-preview.ts`, `src/__tests__/pattern-preview.test.ts`
- Modify: `src/patterns.ts` (extract `computePatternLines`), `index.html` (selector layout), `src/dom.ts`, `src/controls.ts` (selector rewrite + snapshot restore), `src/style.css`

- [ ] **Step 5.1: Extract `computePatternLines` from the thumbnail renderer**

In `src/patterns.ts`, split `renderPatternThumbnail` (lines 250-315): move the line computation into a new exported function directly above it, and have the thumbnail call it.

```ts
/**
 * Compute a pattern's link lines scaled into a size×size square (shared by
 * thumbnails and the selector's Preview). `planetSamples` controls density
 * for planet/geocentric kinds; moon-hexagon and cardioid keep their intrinsic
 * counts (588 views / 200 rim points).
 */
export function computePatternLines(
  pattern: PlanetaryPattern,
  size: number,
  planetSamples: number = 300,
): LinkLine[] {
  const cx = size / 2;
  const cy = size / 2;

  if (pattern.kind === 'cardioid' && pattern.cardioid) {
    const thumbRadius = size * 0.40;
    const thumbN = 200;
    return calculateCardioidLines(cx, cy, thumbN, pattern.cardioid.multiplier, thumbRadius);
  } else if (pattern.kind === 'moon-hexagon') {
    const scale = computeAuScale(pattern, size);
    const a = (pattern.au1 ?? 0.00257) * scale;
    return calculateMoonHexagonLines(
      cx, cy, 588,
      a, pattern.eccentricity1 ?? 0,
      pattern.period1 ?? 27.5545,
      (pattern.precessionPeriodYears1 ?? 8.85) * 365.25,
      SOLAR_SYNODIC_ROTATION_DAYS, MOON_VIEW_JITTER_DAYS, MOON_VIEW_JITTER_PERIOD_DAYS,
    );
  } else if (pattern.geocentric) {
    const scale = computeAuScale(pattern, size);
    return calculateGeocentricLines(
      cx, cy, planetSamples,
      (pattern.au2 ?? 0) * scale, (pattern.au1 ?? 0) * scale,
      pattern.period2 ?? 365.25, pattern.period1 ?? 27.32,
      pattern.simYears,
      pattern.eccentricity1 ?? 0,
      pattern.precessionPeriodYears1 ?? 1000,
    );
  }
  const scale = computeAuScale(pattern, size);
  return calculateEllipticalLines(
    cx, cy, planetSamples,
    pattern.planet1 ?? 'Earth', pattern.planet2 ?? 'Venus',
    pattern.simYears, scale,
  );
}
```

Then reduce `renderPatternThumbnail`'s body to:

```ts
export function renderPatternThumbnail(
  pattern: PlanetaryPattern,
  size: number,
  lineColor: string = 'rgba(194, 118, 46, 0.35)',
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  g.strokeStyle = lineColor;
  g.lineWidth = 0.5;
  for (const line of computePatternLines(pattern, size)) {
    g.beginPath();
    g.moveTo(line.p1.x, line.p1.y);
    g.lineTo(line.p2.x, line.p2.y);
    g.stroke();
  }
  return c;
}
```

Run: `npx vitest run` — Expected: PASS (pure refactor; geocentric branch previously hardcoded 300 samples, now `planetSamples` defaulting to 300 — identical output).

- [ ] **Step 5.2: Write the failing preview test**

Create `src/__tests__/pattern-preview.test.ts`:

```ts
// src/__tests__/pattern-preview.test.ts
//
// The Preview (CONTEXT.md) is fast, looping, and disposable. Only the pure
// loop-timing math is unit-tested; the rAF canvas loop is exercised in the
// browser (E2E step).

import { describe, it, expect } from 'vitest';
import { PREVIEW_LOOP_MS, PREVIEW_HOLD_FRACTION, previewLineFraction } from '../pattern-preview';

describe('previewLineFraction', () => {
  it('starts empty and reaches the full figure before the hold window', () => {
    expect(previewLineFraction(0)).toBe(0);
    expect(previewLineFraction(1 - PREVIEW_HOLD_FRACTION)).toBeCloseTo(1, 10);
  });

  it('holds the completed figure for the tail of the loop', () => {
    expect(previewLineFraction(1 - PREVIEW_HOLD_FRACTION / 2)).toBe(1);
    expect(previewLineFraction(0.999)).toBe(1);
  });

  it('loops fast enough to browse (a few seconds, not a reveal)', () => {
    expect(PREVIEW_LOOP_MS).toBeLessThanOrEqual(4000);
  });
});
```

- [ ] **Step 5.3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/pattern-preview.test.ts`
Expected: FAIL — `Cannot find module '../pattern-preview'`

- [ ] **Step 5.4: Implement the preview module**

Create `src/pattern-preview.ts`:

```ts
// src/pattern-preview.ts
//
// The selector's Preview pane (CONTEXT.md: fast, looping, disposable — never
// touches the field or the user's probes). A small rAF loop redraws the
// selected pattern's lines progressively, then holds the finished figure.

import { computePatternLines, type PlanetaryPattern } from './patterns';
import type { LinkLine } from './engine';

export const PREVIEW_LOOP_MS = 3000;
/** Fraction of the loop spent holding the completed figure before restarting. */
export const PREVIEW_HOLD_FRACTION = 0.25;
/** Line density for planet-pair previews (denser than 120px thumbnails). */
export const PREVIEW_SAMPLES = 400;

/** Map loop position 0..1 to the fraction of lines drawn. */
export function previewLineFraction(loopT: number): number {
  return Math.min(loopT / (1 - PREVIEW_HOLD_FRACTION), 1);
}

export interface PreviewLoop {
  /** Swap the previewed pattern and restart the loop (starts it if stopped). */
  setPattern(p: PlanetaryPattern): void;
  /** Cancel the rAF loop (call whenever the selector closes). */
  stop(): void;
}

export function createPreviewLoop(
  canvas: HTMLCanvasElement,
  getLineColor: () => string,
): PreviewLoop {
  const g = canvas.getContext('2d')!;
  let lines: LinkLine[] = [];
  let raf = 0;
  let startTime = 0;

  function frame(now: number): void {
    if (startTime === 0) startTime = now;
    const loopT = ((now - startTime) % PREVIEW_LOOP_MS) / PREVIEW_LOOP_MS;
    const count = Math.floor(previewLineFraction(loopT) * lines.length);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = getLineColor();
    g.lineWidth = 0.6;
    for (let i = 0; i < count; i++) {
      const l = lines[i];
      g.beginPath();
      g.moveTo(l.p1.x, l.p1.y);
      g.lineTo(l.p2.x, l.p2.y);
      g.stroke();
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    setPattern(p: PlanetaryPattern): void {
      lines = computePatternLines(p, canvas.width, PREVIEW_SAMPLES);
      startTime = 0;
      if (raf === 0) raf = requestAnimationFrame(frame);
    },
    stop(): void {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      startTime = 0;
    },
  };
}
```

Run: `npx vitest run src/__tests__/pattern-preview.test.ts` — Expected: PASS (3 tests)

- [ ] **Step 5.5: Rebuild the selector HTML**

In `index.html`, replace the `#pattern-selector` block (lines 28-37) with:

```html
    <!-- ══ Pattern selector — P hotkey. Three panes: inner-planet column |
         live Preview | outer-planet column, plus a Special row for the two
         non-pair patterns (Moon-Earth hexagon, Cardioid). ══ -->
    <div id="pattern-selector" class="hidden" role="dialog" aria-modal="true" aria-label="Choose a planetary pattern">
      <div class="pattern-band">
        <h2 class="pattern-band-title">Choose a Planetary Pattern</h2>
        <div class="pattern-columns">
          <div class="planet-column" role="listbox" aria-label="Inner planet">
            <h3 class="planet-column-title">Inner planet</h3>
            <div id="pattern-inner-list" class="planet-list"></div>
          </div>
          <div class="pattern-preview-pane">
            <canvas id="pattern-preview-canvas" width="280" height="280"></canvas>
            <span id="pattern-preview-name" class="pattern-preview-name"></span>
            <span id="pattern-preview-meta" class="pattern-preview-meta"></span>
            <button id="pattern-confirm-btn" type="button" class="pattern-confirm-btn">
              Explore this pattern
            </button>
            <span class="pattern-confirm-hint">replaces the canvas and any placed probes</span>
          </div>
          <div class="planet-column" role="listbox" aria-label="Outer planet">
            <h3 class="planet-column-title">Outer planet</h3>
            <div id="pattern-outer-list" class="planet-list"></div>
          </div>
        </div>
        <div class="pattern-specials">
          <h3 class="planet-column-title">Special patterns</h3>
          <div id="pattern-cards" class="pattern-cards"></div>
        </div>
        <p class="pattern-band-hint">Press <kbd>P</kbd> to toggle &middot; <kbd>Esc</kbd> to cancel</p>
      </div>
    </div>
```

(`#pattern-cards` is reused for the Special row — `dom.ts` needs no change for it.)

- [ ] **Step 5.6: Register new DOM elements**

In `src/dom.ts`, add to the interface after `patternCardsEl: HTMLElement;`:

```ts
  patternInnerListEl: HTMLElement;
  patternOuterListEl: HTMLElement;
  patternPreviewCanvas: HTMLCanvasElement;
  patternPreviewName: HTMLElement;
  patternPreviewMeta: HTMLElement;
  patternConfirmBtn: HTMLButtonElement;
```

And in `resolveDomElements()` after `patternCardsEl: getEl('pattern-cards'),`:

```ts
    patternInnerListEl: getEl('pattern-inner-list'),
    patternOuterListEl: getEl('pattern-outer-list'),
    patternPreviewCanvas: getEl('pattern-preview-canvas') as HTMLCanvasElement,
    patternPreviewName: getEl('pattern-preview-name'),
    patternPreviewMeta: getEl('pattern-preview-meta'),
    patternConfirmBtn: getEl('pattern-confirm-btn') as HTMLButtonElement,
```

Extend `mockDomElements()` in `src/__tests__/tour.test.ts` (and any other `DomElements` mock) with the six new keys, all `el() as unknown as ...`. The canvas mock needs `getContext`: use `{ ...el(), width: 280, height: 280, getContext: vi.fn(() => null) } as unknown as HTMLCanvasElement` — the preview loop is only created lazily on first `showPatternSelector`, which tests never call, so a null context is never dereferenced.

- [ ] **Step 5.7: Rewrite the selector logic in controls.ts**

In `src/controls.ts`:

Add imports:

```ts
import { PLANET_ORDER, getPatternForPair, patternFromId } from './pattern-generator';
import { createPreviewLoop, type PreviewLoop } from './pattern-preview';
import { ELEMENTS } from './orbital-elements';
```

Add module-level picker state (above `showPatternSelector`):

```ts
// ── Selector picker state ────────────────────────────────────────────────────
// Transient pair selection while the selector is open. Re-seeded from the
// active pattern each time the selector opens; committed only on Confirm.
let pickerInner = 'Venus';
let pickerOuter = 'Earth';
let previewLoop: PreviewLoop | null = null;
```

Replace `showPatternSelector` (lines 385-425) and `selectPattern` (431-439) with:

```ts
function thumbLineColor(state: AppState): string {
  return state.currentTheme === 'dark'
    ? 'rgba(194, 118, 46, 0.4)'
    : 'rgba(92, 58, 33, 0.35)';
}

function showPatternSelector(state: AppState, dom: DomElements): void {
  if (state.isPlaying) togglePlayback(state, dom);

  if (state.drawAnimActive) {
    state.drawAnimActive = false;
    dom.captionEl.classList.remove('visible');
    dom.captionEl.classList.add('hidden');
    if (state.captionTimeoutId) clearTimeout(state.captionTimeoutId);
  }

  // Seed the pair picker from the active pattern when it is a planet pair.
  const cur = state.currentPattern;
  if ((cur.kind ?? 'planet') === 'planet' && !cur.geocentric && cur.planet1 && cur.planet2) {
    pickerInner = cur.planet1;
    pickerOuter = cur.planet2;
  }

  if (previewLoop === null) {
    previewLoop = createPreviewLoop(dom.patternPreviewCanvas, () => thumbLineColor(state));
  }

  renderPlanetColumns(state, dom);
  renderSpecialRow(state, dom);
  updatePreviewPane(state, dom);

  dom.patternSelectorEl.classList.remove('hidden');
}

// One button per planet per column. Right column entries strictly inside the
// picked inner planet's orbit are disabled — "outer" is pair-relative
// (CONTEXT.md: Inner/Outer Planet of a pair), not "outer solar system".
function renderPlanetColumns(state: AppState, dom: DomElements): void {
  dom.patternInnerListEl.innerHTML = '';
  dom.patternOuterListEl.innerHTML = '';

  for (const planet of PLANET_ORDER) {
    const innerBtn = document.createElement('button');
    innerBtn.type = 'button';
    innerBtn.className = 'planet-option';
    innerBtn.textContent = planet;
    innerBtn.disabled = planet === PLANET_ORDER[PLANET_ORDER.length - 1]; // Neptune has no outer partner
    if (planet === pickerInner) innerBtn.classList.add('active');
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
    outerBtn.addEventListener('click', () => {
      pickerOuter = planet;
      renderPlanetColumns(state, dom);
      updatePreviewPane(state, dom);
    });
    dom.patternOuterListEl.appendChild(outerBtn);
  }
}

function updatePreviewPane(state: AppState, dom: DomElements): void {
  const pattern = getPatternForPair(pickerInner, pickerOuter);
  previewLoop?.setPattern(pattern);
  dom.patternPreviewName.textContent = pattern.name;
  dom.patternPreviewMeta.textContent =
    `${pattern.petals} petals · ${pattern.simYears} yr cycle`;
  dom.patternConfirmBtn.disabled = pattern.id === state.currentPattern.id;
  dom.patternConfirmBtn.textContent = pattern.id === state.currentPattern.id
    ? 'Currently exploring'
    : 'Explore this pattern';
}

// The two curated non-pair patterns keep the old thumbnail-card treatment.
function renderSpecialRow(state: AppState, dom: DomElements): void {
  dom.patternCardsEl.innerHTML = '';
  const specials = PATTERNS.filter(p => p.kind === 'moon-hexagon' || p.kind === 'cardioid');
  for (const pattern of specials) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'pattern-card';
    if (pattern.id === state.currentPattern.id) card.classList.add('active');
    card.dataset['pattern'] = pattern.id;

    const thumb = renderPatternThumbnail(pattern, 90, thumbLineColor(state));
    thumb.className = 'pattern-thumb';
    card.appendChild(thumb);

    const label = document.createElement('span');
    label.className = 'pattern-card-planets';
    label.textContent = pattern.kind === 'cardioid'
      ? `Cardioid · n=${pattern.cardioid?.multiplier ?? 2}`
      : pattern.name;
    card.appendChild(label);

    card.addEventListener('click', () => {
      hidePatternSelector(dom);
      if (pattern.id !== state.currentPattern.id) applyPattern(state, dom, pattern);
    });
    dom.patternCardsEl.appendChild(card);
  }
}

function hidePatternSelector(dom: DomElements): void {
  previewLoop?.stop();
  dom.patternSelectorEl.classList.add('hidden');
}
```

Wire the Confirm button in `setupEventHandlers` (next to the other button listeners):

```ts
  // Pattern selector — confirm the picked pair
  dom.patternConfirmBtn.addEventListener('click', () => {
    const pattern = getPatternForPair(pickerInner, pickerOuter);
    hidePatternSelector(dom);
    if (pattern.id !== state.currentPattern.id) applyPattern(state, dom, pattern);
  });
```

- [ ] **Step 5.8: Fix the snapshot restore path for computed patterns**

In `restoreFromSnapshot` (`src/controls.ts:592`), replace:

```ts
  const pat = PATTERNS.find(p => p.id === snap.patternId);
```

with:

```ts
  const pat = patternFromId(snap.patternId);
```

- [ ] **Step 5.9: Style the three panes**

In `src/style.css`, after the existing `.pattern-band` rules (~line 1695), add:

```css
/* Three-pane pair picker (2026-07-05 selector redesign) */
.pattern-columns {
  display: flex;
  align-items: stretch;
  gap: 24px;
}
.planet-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 110px;
}
.planet-column-title {
  font: 500 10px var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-dim);
}
.planet-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.planet-option {
  padding: 7px 14px;
  border-radius: 8px;
  background: var(--tile-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  font: 400 12px var(--font-mono);
  text-align: left;
  cursor: pointer;
}
.planet-option:hover:not(:disabled) { border-color: var(--accent-copper); }
.planet-option.active {
  border-color: var(--accent-amber);
  color: var(--accent-amber);
}
.planet-option:disabled {
  opacity: 0.3;
  cursor: default;
}
.pattern-preview-pane {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
#pattern-preview-canvas {
  width: 280px;
  height: 280px;
  border-radius: 14px;
  background: var(--tile-bg);
  border: 1px solid var(--glass-border);
}
.pattern-preview-name {
  font: 500 14px var(--font-mono);
  color: var(--text-primary);
}
.pattern-preview-meta {
  font: 400 11px var(--font-mono);
  color: var(--text-dim);
}
.pattern-confirm-btn {
  margin-top: 4px;
  padding: 10px 22px;
  border-radius: 10px;
  background: var(--glass-bg);
  border: 1px solid var(--accent-amber);
  color: var(--accent-amber);
  font: 500 12px var(--font-mono);
  cursor: pointer;
}
.pattern-confirm-btn:hover:not(:disabled) { box-shadow: 0 0 14px rgba(240, 160, 48, 0.35); }
.pattern-confirm-btn:disabled { opacity: 0.4; cursor: default; }
.pattern-confirm-hint {
  font: 400 9px var(--font-mono);
  color: var(--text-dim);
}
.pattern-specials {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--glass-border);
  padding-top: 14px;
}
```

(Verify variable names `--tile-bg`, `--text-dim`, `--accent-amber`, `--accent-copper`, `--glass-border`, `--glass-bg`, `--font-mono` against the `:root` block at the top of `style.css` — use whichever exist; the pattern-card rules around line 1578 use the correct names to copy.)

- [ ] **Step 5.10: Type-check + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Likely friction: unused import `PATTERNS` in controls.ts if all uses were replaced — keep it (still used by `startEngine`'s `PATTERNS[0]` and `renderSpecialRow`).

- [ ] **Step 5.11: Visual verification**

In the preview browser: press P → three panes appear; click planets in both columns → middle canvas re-loops the new figure in ~3s, name/meta update; planets inside the picked inner planet's orbit are grayed in the right column; Neptune is disabled on the left; Mercury+Saturn (uncurated) previews and confirms; Confirm runs the two-phase Reveal with generic captions; Special row shows Moon-Earth + Cardioid; Esc cancels without touching the canvas; placed probes survive open→browse→Esc.

- [ ] **Step 5.12: Commit**

```bash
git add src/patterns.ts src/pattern-preview.ts src/__tests__/pattern-preview.test.ts index.html src/dom.ts src/controls.ts src/style.css src/__tests__/tour.test.ts
git commit -m "feat(selector): three-pane inner/outer pair picker with live looping preview"
```

---

### Task 6: Tutorial redo — z-index fix, Back/Next, accurate steps, pattern-picker step

**Files:**
- Modify: `index.html` (tooltip as sibling + Back/Next buttons), `src/style.css` (z-indices), `src/dom.ts`, `src/tour.ts` (steps, nav, new action), `src/controls.ts` (notify), `src/__tests__/tour.test.ts`

**Why the restructure:** sibling stacking contexts can't interleave — anything inside `#intro-tour` (z-95) paints below the node-editor panel (z-120) no matter its inner z-index. The fix layers three *siblings*: scrim container 170 < lifted target 171 < tooltip 172.

- [ ] **Step 6.1: Write the failing tests**

In `src/__tests__/tour.test.ts`:

Add to `mockDomElements()` return object (with the Task 1/5 additions already in place):

```ts
    tourTooltip: el() as unknown as HTMLElement,
    tourBack: el() as unknown as HTMLButtonElement,
    tourNext: el() as unknown as HTMLButtonElement,
```

Replace the `'has exactly 5 steps (sweeper-only flow)'` test and append new ones:

```ts
  it('has 6 steps: spawn → editor → cable → play → pattern picker → done', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    tour.notify('editor-opened');
    tour.notify('cable-connected');
    tour.notify('play-pressed');
    tour.notify('pattern-opened');
    expect(tour.currentStep).toBe(5);
    expect(tour.isActive).toBe(true);
  });

  it('pattern-opened advances from step 4 to step 5', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    tour.notify('editor-opened');
    tour.notify('cable-connected');
    tour.notify('play-pressed');
    expect(tour.currentStep).toBe(4);
    tour.notify('pattern-opened');
    expect(tour.currentStep).toBe(5);
  });

  it('back() re-shows the previous step without undoing anything', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.notify('sweeper-spawned');
    tour.notify('editor-opened');
    expect(tour.currentStep).toBe(2);
    tour.back();
    expect(tour.currentStep).toBe(1);
    expect(tour.isActive).toBe(true);
  });

  it('back() at step 0 is a no-op', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.back();
    expect(tour.currentStep).toBe(0);
    expect(tour.isActive).toBe(true);
  });

  it('next() skips a step the user already performed', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.next();
    expect(tour.currentStep).toBe(1);
  });

  it('next() on the final step ends the tour', () => {
    const tour = createTourController(dom);
    tour.start();
    for (let i = 0; i < 5; i++) tour.next();
    expect(tour.currentStep).toBe(5);
    tour.next();
    expect(tour.isActive).toBe(false);
    expect(localStorage.getItem('intro-tour-done')).toBe('true');
  });

  it('an out-of-order action still advances only its own step', () => {
    const tour = createTourController(dom);
    tour.start();
    tour.next(); // user skipped ahead past "spawn"
    tour.notify('sweeper-spawned'); // late notify for step 0 — must not advance step 1
    expect(tour.currentStep).toBe(1);
  });
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/tour.test.ts`
Expected: FAIL — `tour.back is not a function`, `pattern-opened` not assignable to `TourAction`, step-count mismatch.

- [ ] **Step 6.3: Restructure the tour HTML**

In `index.html`, replace the `#intro-tour` block (lines 46-57) with:

```html
    <!-- ══ Intro Tour — first-time guided walkthrough.
         Layering (siblings, so lifted panels can interleave):
         #intro-tour (scrim+spotlight) z-170 < lifted target z-171 < #intro-tooltip z-172. ══ -->
    <div id="intro-tour" class="hidden" aria-label="Introduction tour">
      <div id="intro-scrim"></div>
      <div id="intro-spotlight"></div>
    </div>
    <div id="intro-tooltip" class="hidden">
      <span id="intro-step-counter" class="intro-step-counter"></span>
      <p id="intro-text" class="intro-text"></p>
      <div id="intro-actions" class="intro-actions">
        <button id="intro-back" class="intro-nav-btn" type="button">&larr; Back</button>
        <button id="intro-next" class="intro-nav-btn" type="button">Next &rarr;</button>
        <button id="intro-got-it" class="intro-got-it hidden" type="button">Got it</button>
      </div>
      <button id="intro-skip" class="intro-skip" type="button">Skip tour</button>
    </div>
```

- [ ] **Step 6.4: Fix the CSS layering**

In `src/style.css`:
- `#intro-tour` rule (line ~1421-1424): change `z-index: 95` → `z-index: 170`.
- `#intro-tooltip` rule (line ~1472): change `z-index: 96` → `z-index: 172`, and ensure it has `position: fixed;` and `pointer-events: auto;` (it previously inherited placement from the wrapper; keep its existing `top: 24px; left: 50%; transform: translateX(-50%); max-width: 420px;` styling — verify those properties exist on the rule and add them if they were on the parent).
- Add `#intro-tooltip.hidden { display: none; }` if `.hidden` on it isn't already covered by a global `.hidden` rule (check `grep -n "^\.hidden" src/style.css` — a global rule likely exists; if so skip this).
- Add button styles near `.intro-got-it`:

```css
.intro-nav-btn {
  padding: 5px 12px;
  border-radius: 7px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  font: 400 11px var(--font-mono);
  cursor: pointer;
}
.intro-nav-btn:hover:not(:disabled) { border-color: var(--accent-copper); }
.intro-nav-btn:disabled { opacity: 0.35; cursor: default; }
```

- [ ] **Step 6.5: Register tooltip + nav buttons in dom.ts**

In `src/dom.ts` interface, after `tourEl: HTMLElement;` add:

```ts
  tourTooltip: HTMLElement;
  tourBack: HTMLButtonElement;
  tourNext: HTMLButtonElement;
```

In `resolveDomElements()` after `tourEl: getEl('intro-tour'),`:

```ts
    tourTooltip: getEl('intro-tooltip'),
    tourBack: getEl('intro-back') as HTMLButtonElement,
    tourNext: getEl('intro-next') as HTMLButtonElement,
```

- [ ] **Step 6.6: Rewrite tour.ts**

Replace the step definitions, action type, and controller in `src/tour.ts`:

```ts
export type TourAction =
  | 'sweeper-spawned'
  | 'editor-opened'
  | 'cable-connected'
  | 'play-pressed'
  | 'pattern-opened';
```

```ts
const tourSteps: TourStep[] = [
  { // 0 — Spawn a sweeper
    target: () => document.getElementById('foundry-shapes'),
    text: 'Click the <strong>Sweeper</strong> card in the Sonic Foundry dock below (or press <kbd>N</kbd>) to place a sweeper probe at the Sun.',
    trigger: 'action',
  },
  { // 1 — Open the editor
    target: () => document.body,
    text: 'Click the sweeper on the canvas (or press <kbd>E</kbd> while it’s selected) to open its node editor.',
    trigger: 'action',
  },
  { // 2 — Connect a cable
    target: () => document.getElementById('node-editor-panel'),
    text: 'Drag a cable from a <strong>data node</strong>’s output port to a <strong>sound node</strong>’s input port. The mapping commits when the editor closes.',
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
```

Extend the controller interface:

```ts
export interface TourController {
  start(): void;
  end(skipped?: boolean): void;
  notify(action: TourAction): void;
  back(): void;
  next(): void;
  readonly isActive: boolean;
  readonly currentStep: number;
}
```

In `createTourController`:

- In `showStep()`, change the lift value `'96'` → `'171'` (line 119) and update the counter line to `Step ${stepIdx + 1} of ${tourSteps.length}` (unchanged code, new length). After the got-it toggle, add nav-button state:

```ts
    dom.tourBack.disabled = stepIdx === 0;
    dom.tourNext.classList.toggle('hidden', step.trigger === 'gotit');
```

- In `start()` and `end()`, toggle the sibling tooltip alongside the scrim container:

```ts
    // in start():
    dom.tourEl.classList.remove('hidden');
    dom.tourTooltip.classList.remove('hidden');
    // in end():
    dom.tourEl.classList.add('hidden');
    dom.tourTooltip.classList.add('hidden');
```

- Add the two nav functions and return them:

```ts
  function back(): void {
    if (!active || stepIdx === 0) return;
    stepIdx--;
    showStep();
  }

  function next(): void {
    if (!active) return;
    advance();
  }
```

- Wire buttons next to the existing skip/got-it listeners:

```ts
  dom.tourBack.addEventListener('click', back);
  dom.tourNext.addEventListener('click', next);
```

- Extend `notify` with the new action:

```ts
    else if (action === 'pattern-opened'  && idx === 4) advance();
```

- Return `{ start, end, notify, back, next, get isActive... }`.

- [ ] **Step 6.7: Notify pattern-opened from controls.ts**

In the `'p'` case of the keydown handler (`src/controls.ts:1015-1025`), after `showPatternSelector(state, dom);` add:

```ts
          tour.notify('pattern-opened');
```

(`tour` is already in scope — `setupEventHandlers` receives it.)

- [ ] **Step 6.8: Run tests**

Run: `npx vitest run src/__tests__/tour.test.ts`
Expected: PASS — all prior tests (5-step flow ones updated) plus 7 new.

Then: `npx tsc --noEmit && npx vitest run`
Expected: full suite PASS.

- [ ] **Step 6.9: E2E-verify the tour (the bug report was about real rendering)**

In the preview browser with `?tour` appended to the URL: start the engine, then confirm each fix: (a) on the cable step the tooltip is fully visible ABOVE the opened node editor panel; (b) Back re-shows the previous instruction from every step and is disabled on step 1; (c) Next skips forward; (d) each instruction matches what the UI actually shows (dock label "Sonic Foundry", play button top-left, P opens the three-pane picker); (e) pressing P on step 5 advances to the final Got-it card spotlighting the selector; (f) Esc still ends the tour; (g) `localStorage['intro-tour-done']` set after finish.

- [ ] **Step 6.10: Commit**

```bash
git add index.html src/style.css src/dom.ts src/tour.ts src/controls.ts src/__tests__/tour.test.ts
git commit -m "fix(tour): layer tooltip above node editor, add Back/Next, accurate copy, pattern-picker step"
```

---

### Task 7: Full verification, Progress.md, final commit

- [ ] **Step 7.1: Full gate**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all suites pass (25 pre-existing + 3 new files; 2 pre-existing skips are normal).

- [ ] **Step 7.2: Manual E2E per CLAUDE.md**

In the preview browser (fresh profile / cleared localStorage):
1. Overlay shows the sonification notice + two buttons; **no sound before any click**.
2. "Start muted" → reveal plays, speaker shows 🔇; spawn a sweeper, connect a cable, press Space → **silence**; click 🔊 → sound appears mid-pattern. Press M → mutes again.
3. Reload → "Start with sound" → Venus/Earth discs crawl ~7s, captions sync, acceleration completes the pentagram, discs fade.
4. Spawn a sweeper AND a circle — no sound before Play/Cmd+Enter; circle's seeded Collision→Rhythm + Distance→Pitch graph plays a morphing rhythm; moving/resizing the circle changes it (CLAUDE.md E2E requirement).
5. P → pick Mercury + Saturn → preview loops → Confirm → computed reveal with generic captions; save config (Cmd+S), reload, load config → Mercury–Saturn restores (computed-id round trip).
6. `?tour` run per Step 6.9.

- [ ] **Step 7.3: Document in Progress.md**

Append an entry (match the existing dated format):

```md
## 2026-07-05 — Onboarding, three-pane selector, two-phase Reveal, tour redo

- **Sound notice + mute**: start overlay now offers "Start with sound" / "Start
  muted"; both initialize audio on the click gesture (autoplay policy) and
  muting only zeroes a master GainNode inserted after the compressor
  (audio.ts) — Muted ≠ Paused (CONTEXT.md). Persistent 🔊 toggle + M hotkey,
  preference in localStorage('sound-muted').
- **Reveal** (CONTEXT.md term): draw animation is now two-phase
  (src/reveal.ts): 7s guided crawl revealing 12% of lines with planet discs +
  labels + a bright live chord at the newest line's endpoints (p1/p2 of
  calculateEllipticalLines ARE the planet positions — no new orbital math),
  then quadratic-ease-in completion while the discs fade. Captions stay keyed
  on TIME fraction, so authored caption scripts were untouched.
- **Three-pane selector** (ADR 0002 hybrid model): inner-planet column |
  looping Preview canvas | outer-planet column + Special row (Moon-Earth,
  Cardioid). Any valid pair computes a pattern from JPL elements
  (src/pattern-generator.ts — period from 360/LDot·36525, resonance search
  for simYears/petals); curated pairs return the authored catalogue object.
  GOTCHA: restoreFromSnapshot previously did PATTERNS.find(id) — computed
  `pair-*` ids need patternFromId() or saved configs silently fail.
- **Tour redo**: root cause of the "dialog covered" bug was sibling stacking
  contexts — the tooltip lived INSIDE #intro-tour (z-95) so no inner z-index
  could beat the node editor panel (z-120). Fix: tooltip is now a SIBLING at
  z-172, scrim container 170, lifted targets 171. Added Back/Next (Back only
  re-shows instructions, never undoes state), rewrote step copy against the
  real UI, added a 'pattern-opened' step so the tour ends at the new picker.
```

- [ ] **Step 7.4: Commit docs**

```bash
git add Progress.md CONTEXT.md docs/adr/0002-hybrid-curated-computed-patterns.md docs/superpowers/plans/2026-07-05-onboarding-selector-reveal-tutorial.md
git commit -m "docs: Progress.md entry, glossary terms, ADR 0002, implementation plan"
```

---

## Self-review notes

- **Spec coverage:** sound notice + on/off (Task 1) ✓; slow-then-fast educational reveal with planets (Tasks 2-3) ✓; three-section selector with middle preview (Tasks 4-5) ✓; tutorial covered-dialog/back/accuracy (Task 6) ✓; CLAUDE.md gates (Task 7) ✓.
- **Type consistency:** `revealLineFraction(tFrac, guidedTimeFrac)` used identically in main.ts and tests; `PreviewLoop.setPattern/stop` used in controls.ts; `patternFromId` return `PlanetaryPattern | null` matches `restoreFromSnapshot`'s existing null guard (`if (!pat) { showToast... }`).
- **Known risks:** (1) `state.test.ts`/`renderer.test.ts` may build `AppState` literals — add `muted`/`drawGuidedTimeFrac` where the compiler complains. (2) CSS variable names in new rules must be checked against `:root` before use. (3) `#intro-tooltip` extraction: any CSS selector of the form `#intro-tour #intro-tooltip` (descendant) must be flattened — grep `intro-tooltip` in style.css first.
