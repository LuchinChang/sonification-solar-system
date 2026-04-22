// src/node-editor/sidebar.ts
//
// Unit 2 — Shape-options sidebar (post-ship UX improvement #11).
//
// The sweeper editor is a node-graph view of CABLE-WIRED rules. But a handful
// of controls are fundamentally "knobs on the shape itself" — they never get
// mapped from a data source:
//
//   playback.mode        → shape.playbackMode
//   sweeper.length       → shape.size
//   sweeper.fineness     → shape.fineness
//   sweeper.cluster-count→ shape.k
//   sweeper.generator    → shape.instrument
//
// Before this unit they appeared in the toolbox drawer alongside mappable
// data/sound chips, which was confusing. Now they live in a dedicated left
// sidebar so the toolbox only exposes chips that *can* be cabled.
//
// The sidebar queries the registry for `listNodeDefs('sweeper')` and
// `listNodeDefs('playback')` so adding / removing a sweeper-self NodeDefinition
// automatically shows up here — no hardcoded list.
//
// DEFERRED-COMMIT still holds: the ui() hooks mutate the sweeper's properties
// directly; the live Strudel re-eval happens on panel close (same as cabled
// nodes). The sidebar never talks to codegen.

import type { CanvasShape } from '../shapes';
import { applyPlaybackNode } from './nodes/playback';
import { listNodeDefs } from './registry';
import type { Node, NodeDefinition, NodeSide } from './types';

// ── Public types ────────────────────────────────────────────────────────────

export interface SidebarCallbacks {
  /** Resolve a sweeperId to its CanvasShape. Used for the colour swatch. */
  resolveSweeper: (id: number) => CanvasShape | null;
}

// ── Module state ────────────────────────────────────────────────────────────

interface SidebarRefs {
  root:    HTMLElement;
  swatch:  HTMLSpanElement;
  title:   HTMLSpanElement;
  body:    HTMLDivElement;
}

let refs: SidebarRefs | null = null;
let callbacks: SidebarCallbacks | null = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Wire the sidebar to a host element (e.g. `<aside id="shape-options-sidebar">`).
 * Idempotent — calling twice with the same host just rebinds the callbacks.
 */
export function initSidebar(host: HTMLElement, cb: SidebarCallbacks): void {
  callbacks = cb;
  refs = buildChrome(host);
}

/** Populate + show the sidebar for a given sweeper. */
export function openSidebar(sweeperId: number): void {
  if (refs === null || callbacks === null) return;
  const sweeper = callbacks.resolveSweeper(sweeperId);
  if (sweeper === null || sweeper.type !== 'sweeper') return;

  const color = sweeper.sweepColor;
  refs.swatch.style.color           = color;
  refs.swatch.style.backgroundColor = color;
  refs.title.textContent            = `Sweeper #${sweeper.id}`;

  renderBody(sweeper);

  refs.root.classList.remove('hidden');
  refs.root.removeAttribute('aria-hidden');
  refs.root.removeAttribute('inert');
}

/** Hide the sidebar and clear transient state. */
export function closeSidebar(): void {
  if (refs === null) return;
  refs.root.classList.add('hidden');
  refs.root.setAttribute('aria-hidden', 'true');
  refs.root.setAttribute('inert', '');
}

/** Test helper — true iff the sidebar is currently visible. */
export function isSidebarOpen(): boolean {
  return refs !== null && !refs.root.classList.contains('hidden');
}

// ── DOM construction ────────────────────────────────────────────────────────

function buildChrome(host: HTMLElement): SidebarRefs {
  host.replaceChildren();

  const header = document.createElement('div');
  header.className = 'sidebar-header';

  const swatch = document.createElement('span');
  swatch.className = 'sidebar-swatch';
  swatch.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'sidebar-title';
  title.textContent = 'Shape Options';

  header.append(swatch, title);

  const body = document.createElement('div');
  body.className = 'sidebar-body';

  host.append(header, body);

  return { root: host, swatch, title, body };
}

// ── Body rendering ──────────────────────────────────────────────────────────

/** Display order of side groups inside the sidebar. */
const SIDEBAR_SIDES: readonly NodeSide[] = ['playback', 'sweeper'];

/** Pretty section headers per side. */
const SECTION_TITLES: Record<NodeSide, string> = {
  data:     'Data',
  sound:    'Sound',
  sweeper:  'Shape',
  playback: 'Playback',
};

function renderBody(sweeper: CanvasShape): void {
  if (refs === null) return;
  refs.body.replaceChildren();

  for (const side of SIDEBAR_SIDES) {
    const defs = listNodeDefs(side);
    if (defs.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'sidebar-section';
    section.dataset['side'] = side;

    const h = document.createElement('h3');
    h.className = 'sidebar-section-title';
    h.textContent = SECTION_TITLES[side];
    section.appendChild(h);

    for (const def of defs) section.appendChild(buildChip(def, sweeper));
    refs.body.appendChild(section);
  }
}

/**
 * Build one form-row per NodeDefinition. Prefers `def.ui(node, onChange)` when
 * defined (handles all sweeper-self + playback nodes today); falls back to
 * auto-rendering `defaultParams` as `<select>`/`<input type="number">` rows
 * so an ad-hoc future NodeDefinition without a custom ui() still works.
 */
function buildChip(def: NodeDefinition, sweeper: CanvasShape): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'sidebar-chip';
  chip.dataset['type'] = def.type;
  chip.dataset['side'] = def.side;

  const title = document.createElement('div');
  title.className = 'sidebar-chip-title';
  title.textContent = def.label;
  chip.appendChild(title);

  const body = document.createElement('div');
  body.className = 'sidebar-chip-body';

  // Build a transient Node so def.ui() has something to bind to. Params are
  // hydrated from the sweeper's current properties so opening the sidebar
  // shows the live value, not the factory default.
  const node: Node = {
    id:     `sidebar-${def.type}`,
    type:   def.type,
    side:   def.side,
    x:      0,
    y:      0,
    params: hydrateParamsFromSweeper(def, sweeper),
  };

  if (def.ui) {
    try {
      body.appendChild(def.ui(node, patch => {
        Object.assign(node.params, patch.params ?? {});
        // Sweeper-self NodeDefinitions (sweeper.*) already mutate the shape from
        // inside their ui() via setSweeperResolver. playback.mode's ui() only
        // updates the node's params, so we apply the side-effect here — without
        // this, switching playback mode in the sidebar would never reach the
        // CanvasShape.
        if (def.type === 'playback.mode') applyPlaybackNode(node, sweeper);
      }));
    } catch (err) {
      console.warn('[sidebar] ui() threw for', def.type, err);
      body.appendChild(renderFallback(def, node));
    }
  } else {
    body.appendChild(renderFallback(def, node));
  }

  chip.appendChild(body);
  return chip;
}

/**
 * Seed a transient Node's params from the sweeper's live properties so the
 * ui() shows the current value, not the factory default.
 *
 * Explicit map — adding a new sweeper-self NodeDefinition only needs a line
 * here if its param key doesn't match the CanvasShape property directly.
 */
function hydrateParamsFromSweeper(
  def: NodeDefinition,
  sweeper: CanvasShape,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(def.defaultParams ?? {}) };
  switch (def.type) {
    case 'playback.mode':           base['mode']     = sweeper.playbackMode; break;
    case 'sweeper.cluster-count':   base['k']        = sweeper.k;            break;
    case 'sweeper.fineness':        base['steps']    = sweeper.fineness;     break;
    case 'sweeper.generator':       base['waveform'] = sweeper.instrument;   break;
    case 'sweeper.length':          base['radius']   = sweeper.size;         break;
    default:
      // Unknown NodeDefinition — leave defaults untouched.
      break;
  }
  return base;
}

/**
 * Fallback renderer for NodeDefinitions that don't ship a ui() hook. Emits a
 * <select> for enum-like defaults (string inputs with 2+ options can't be
 * inferred, so we just show a text input) and <input type="number"> for
 * numeric defaults.
 */
function renderFallback(def: NodeDefinition, node: Node): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-fallback';

  for (const [key, value] of Object.entries(def.defaultParams ?? {})) {
    const row = document.createElement('label');
    row.className = 'sidebar-fallback-row';

    const label = document.createElement('span');
    label.className = 'sidebar-fallback-label';
    label.textContent = key;

    let input: HTMLInputElement | HTMLSelectElement;
    if (typeof value === 'number') {
      const num = document.createElement('input');
      num.type = 'number';
      num.value = String(value);
      num.addEventListener('input', () => {
        const parsed = parseFloat(num.value);
        if (Number.isFinite(parsed)) node.params[key] = parsed;
      });
      input = num;
    } else {
      const text = document.createElement('input');
      text.type = 'text';
      text.value = String(value);
      text.addEventListener('input', () => { node.params[key] = text.value; });
      input = text;
    }

    row.append(label, input);
    wrap.appendChild(row);
  }
  return wrap;
}

