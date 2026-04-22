// src/node-editor/panel.ts
//
// Glassmorphic panel shell for the sweeper node-editor.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────┐
//   │ Header: color swatch · "Sweeper #N" · close              │
//   ├────────────┬──────────────────────────┬──────────────────┤
//   │ Data Rules │  sweeper icon + cables  │   Sound Rules     │
//   └────────────┴──────────────────────────┴──────────────────┘
//
// DEFERRED-COMMIT POLICY
// ──────────────────────
// The graph is NOT compiled to Strudel while the panel is open. All edits
// are pure data mutations on the in-memory NodeGraph. `closeEditor()` is
// the single commit point. Unit 14 will slot its codegen call at the
// marked hook below.

import type { CanvasShape } from '../shapes';
import { createGraph } from './graph';
import { mountToolbox, refreshToolbox } from './toolbox';
import type { NodeGraph } from './types';

// ── Module state ─────────────────────────────────────────────────────────────

// leftCol / rightCol / cableLayer are captured now so Units 11-13 can populate
// them without re-querying the DOM; closeBtn is kept for future enable/disable.
interface EditorRefs {
  root:          HTMLDivElement;
  swatch:        HTMLSpanElement;
  sweeperNumEl:  HTMLSpanElement;
  sweeperIcon:   HTMLDivElement;
  closeBtn:      HTMLButtonElement;
  leftCol:       HTMLDivElement;
  center:        HTMLDivElement;
  rightCol:      HTMLDivElement;
  cableLayer:    SVGSVGElement;
}

let refs: EditorRefs | null = null;
let activeSweeperId: number | null = null;
let activeGraph:     NodeGraph | null = null;

// Caller-supplied resolver: id → CanvasShape. Wired by main.ts via init().
let resolveSweeper: ((id: number) => CanvasShape | null) | null = null;

// Document keydown handler — registered on first open, torn down on close.
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

// ── Public init — called once from main.ts at boot ───────────────────────────

/**
 * Hand the panel module a way to resolve sweeper ids to their CanvasShape
 * objects (for color + label). Keeps this module decoupled from AppState.
 */
export function initNodeEditor(opts: { resolveSweeper: (id: number) => CanvasShape | null }): void {
  resolveSweeper = opts.resolveSweeper;
  ensureMounted();
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Open the editor for a given sweeper. No-op (warns) if id doesn't resolve. */
export function openEditor(sweeperId: number): void {
  ensureMounted();
  if (refs === null || resolveSweeper === null) return;
  const sweeper = resolveSweeper(sweeperId);
  if (!sweeper || sweeper.type !== 'sweeper') {
    console.warn('[node-editor] openEditor: id is not a sweeper', sweeperId);
    return;
  }

  activeSweeperId = sweeperId;
  // Phase 2+ will persist graphs per-sweeper; for Unit 4 we spin a fresh one.
  activeGraph = createGraph(sweeperId);

  const color = sweeper.sweepColor;
  refs.swatch.style.color          = color;
  refs.swatch.style.backgroundColor = color;
  refs.sweeperIcon.style.color     = color;
  refs.sweeperNumEl.textContent    = `Sweeper #${sweeper.id}`;

  // Re-render chip list in case new NodeDefinitions registered since last open.
  refreshToolbox(toolboxHost(refs), toolboxCallbacks());

  refs.root.classList.remove('hidden');
  refs.root.removeAttribute('aria-hidden');
  refs.root.removeAttribute('inert');
  attachKeyHandler();
}

/**
 * Close the panel and hand off to codegen.
 *
 * TODO(Unit 14): call into the codegen pipeline here, e.g.
 *   if (activeGraph) compileGraphToStrudel(activeGraph);
 * Codegen is DEFERRED by design — it never runs during drag/edit.
 */
export function closeEditor(): void {
  if (refs === null) return;
  refs.root.classList.add('hidden');
  refs.root.setAttribute('aria-hidden', 'true');
  refs.root.setAttribute('inert', '');

  // TODO(Unit 14): compileGraphToStrudel(activeGraph) here.
  //   - Walk nodes in topological order.
  //   - Call each NodeDefinition.codegen() with a CodegenCtx.
  //   - Splice the resulting fragment into the live Strudel source.

  activeSweeperId = null;
  activeGraph     = null;
  detachKeyHandler();
}

/** Currently-open sweeper id, or null. Exposed for later units. */
export function currentSweeperId(): number | null { return activeSweeperId; }

/** Current in-memory graph (read-only reference). Exposed for later units. */
export function currentGraph(): NodeGraph | null { return activeGraph; }

// ── DOM construction ─────────────────────────────────────────────────────────

function ensureMounted(): void {
  if (refs !== null) return;

  const root = document.createElement('div');
  root.id = 'node-editor-panel';
  root.className = 'hidden';
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('inert', '');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Sweeper node editor');

  // Header ────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'node-editor-header';

  const swatch = document.createElement('span');
  swatch.className = 'node-editor-swatch';

  const titleLabel = document.createElement('span');
  titleLabel.className = 'node-editor-title';
  titleLabel.textContent = 'Node Editor —';

  const sweeperNumEl = document.createElement('span');
  sweeperNumEl.className = 'node-editor-sweeper-num';
  sweeperNumEl.textContent = 'Sweeper #?';

  const hint = document.createElement('span');
  hint.className = 'node-editor-hint';
  hint.textContent = 'Esc to close · Ctrl+Enter to commit';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'node-editor-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close node editor');
  closeBtn.addEventListener('click', closeEditor);

  header.append(swatch, titleLabel, sweeperNumEl, hint, closeBtn);

  // Body ──────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'node-editor-body';

  const leftCol  = buildColumn('Data Rules',  'Drop data-sided rule nodes here');
  const rightCol = buildColumn('Sound Rules', 'Drop sound-sided rule nodes here');

  const center = document.createElement('div');
  center.className = 'node-editor-center';

  const sweeperIcon = document.createElement('div');
  sweeperIcon.className = 'node-editor-sweeper-icon';
  sweeperIcon.textContent = 'SWP';

  const cableLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cableLayer.setAttribute('class', 'node-editor-cable-layer');
  cableLayer.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  center.append(cableLayer, sweeperIcon);
  body.append(leftCol, center, rightCol);

  root.append(header, body);
  document.body.appendChild(root);

  refs = {
    root,
    swatch,
    sweeperNumEl,
    sweeperIcon,
    closeBtn,
    leftCol,
    center,
    rightCol,
    cableLayer,
  };

  // Unit 13: drop-in toolbox drawer along the bottom of the panel.
  mountToolbox(toolboxHost(refs), toolboxCallbacks());
}

function toolboxHost(r: EditorRefs): { root: HTMLElement; leftCol: HTMLElement; center: HTMLElement; rightCol: HTMLElement } {
  return { root: r.root, leftCol: r.leftCol, center: r.center, rightCol: r.rightCol };
}

function toolboxCallbacks(): { getGraph: () => NodeGraph | null; onGraphChanged: () => void } {
  return { getGraph: () => activeGraph, onGraphChanged: emitGraphChanged };
}

// ── Graph-change notification ────────────────────────────────────────────────
//
// Units 11/12/14 subscribe to this to rebuild cables and recompute codegen.
// The event bubbles on the panel root so listeners can be scoped without a
// global pub/sub.

const GRAPH_CHANGED_EVENT = 'graphChanged';

function emitGraphChanged(): void {
  if (refs === null) return;
  refs.root.dispatchEvent(new CustomEvent(GRAPH_CHANGED_EVENT, {
    bubbles: true,
    detail: { sweeperId: activeSweeperId, graph: activeGraph },
  }));
}

function buildColumn(title: string, placeholder: string): HTMLDivElement {
  const col = document.createElement('div');
  col.className = 'node-editor-col';

  const h = document.createElement('h3');
  h.className = 'node-editor-col-title';
  h.textContent = title;

  const p = document.createElement('p');
  p.className = 'node-editor-col-placeholder';
  p.textContent = placeholder;

  col.append(h, p);
  return col;
}

// ── Keyboard: Escape closes (listener is scoped to when panel is open) ───────

function attachKeyHandler(): void {
  if (keyHandler !== null) return;
  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeEditor();
    }
  };
  document.addEventListener('keydown', keyHandler, true);
}

function detachKeyHandler(): void {
  if (keyHandler === null) return;
  document.removeEventListener('keydown', keyHandler, true);
  keyHandler = null;
}

/** Test helper — true iff the panel root is currently visible. */
export function isEditorOpen(): boolean {
  return refs !== null && !refs.root.classList.contains('hidden');
}
