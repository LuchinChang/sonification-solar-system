// src/node-editor/panel.ts
//
// Glassmorphic panel shell for the sweeper node-editor.
//
// Layout (Unit 3 overhaul — freeform canvas, draw.io-style):
//   ┌──────────────────────────────────────────────────────────┐
//   │ Header: color swatch · "Sweeper #N" · close              │
//   ├──────────────────────────────────────────────────────────┤
//   │  <div class="node-editor-canvas">                        │
//   │    absolutely-positioned chips, colored by side          │
//   │    + overlaid SVG cable layer                            │
//   │  </div>                                                  │
//   └──────────────────────────────────────────────────────────┘
//
// DEFERRED-COMMIT POLICY
// ──────────────────────
// The graph is NOT compiled to Strudel while the panel is open. All edits
// (including node drags) are pure data mutations on the in-memory NodeGraph.
// `closeEditor()` is the single commit point. Codegen runs exactly there —
// never during drag/drop.

import type { NodeGraphSnapshot } from '../config-snapshot';
import type { CanvasShape } from '../shapes';
import { CABLE_REFLOW_EVENT, initCables } from './cables';
import { compileGraphToStrudel } from './codegen';
import { addEdge, addNode, createGraph, graphFromSnapshot, removeNode } from './graph';
import { getNodeDef } from './registry';
import { applyPlaybackNode } from './nodes/playback';
import { openSidebar, closeSidebar } from './sidebar';
import { mountToolbox, refreshToolbox } from './toolbox';
import type { Node, NodeDefinition, NodeGraph, PortSpec } from './types';
// Side-effect import: registers the four sound-basic NodeDefinitions so the
// default-graph seeding below can find them via getNodeDef().
import './nodes/sound-basic';

// Grid-snap step for freeform chip positions (px). Matches the 24px dot-grid
// background of the canvas.
const GRID_SNAP_PX = 24;
// Default initial positions for seeded / toolbox-dropped nodes. Kept sparse
// so chips don't land on top of each other.
const DEFAULT_NODE_WIDTH  = 180;
const DEFAULT_NODE_HEIGHT = 90;

// ── Module state ─────────────────────────────────────────────────────────────

// canvas + cableLayer are captured once so drag / drop / cable code doesn't
// have to re-query the DOM; closeBtn is kept for future enable/disable.
interface EditorRefs {
  root:          HTMLDivElement;
  swatch:        HTMLSpanElement;
  sweeperNumEl:  HTMLSpanElement;
  closeBtn:      HTMLButtonElement;
  canvas:        HTMLDivElement;
  cableLayer:    SVGSVGElement;
}

let refs: EditorRefs | null = null;
let activeSweeperId: number | null = null;
let activeGraph:     NodeGraph | null = null;

// Caller-supplied resolver: id → CanvasShape. Wired by main.ts via init().
let resolveSweeper: ((id: number) => CanvasShape | null) | null = null;

/**
 * Optional commit hook supplied by main.ts. Called from closeEditor() AFTER
 * the graph is saved to shape.graph. Main wires this to telemetry's
 * patchShapeBlock so the live Strudel textarea is updated in one atomic
 * swap — DEFERRED until close, never during drag/edit (Unit 14).
 */
let commitGraph: ((shape: CanvasShape, compiledBlock: string) => void) | null = null;

// Document keydown handler — registered on first open, torn down on close.
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

// ── Public init — called once from main.ts at boot ───────────────────────────

/**
 * Hand the panel module a way to resolve sweeper ids to their CanvasShape
 * objects (for color + label). Keeps this module decoupled from AppState.
 */
export function initNodeEditor(opts: {
  resolveSweeper: (id: number) => CanvasShape | null;
  /** Called on closeEditor() with the freshly-compiled sweeper block. */
  commit?: (shape: CanvasShape, compiledBlock: string) => void;
}): void {
  resolveSweeper = opts.resolveSweeper;
  commitGraph    = opts.commit ?? null;
  ensureMounted();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Open the editor for a given sweeper.
 *
 * Toggle semantics:
 *  - If the panel is already open for the SAME sweeper id → close it.
 *  - If the panel is open for a DIFFERENT sweeper → repoint to the new one.
 *  - Otherwise just open.
 *
 * No-op (warns) if the id doesn't resolve to a sweeper.
 */
export function openEditor(sweeperId: number): void {
  ensureMounted();
  if (refs === null || resolveSweeper === null) return;
  const sweeper = resolveSweeper(sweeperId);
  if (!sweeper || sweeper.type !== 'sweeper') {
    console.warn('[node-editor] openEditor: id is not a sweeper', sweeperId);
    return;
  }

  // Toggle: same sweeper, already open → close and bail.
  if (isEditorOpen() && activeSweeperId === sweeperId) {
    closeEditor();
    return;
  }

  activeSweeperId = sweeperId;

  // If the sweeper has a saved graph snapshot, hydrate it. Otherwise seed the
  // default wiring (distance → lpf, cluster-count → gain) that mirrors the
  // pre-overhaul behaviour so audio never drops out on first spawn.
  if (sweeper.graph !== null && sweeper.graph !== undefined) {
    const hydrated = graphFromSnapshot(sweeper.graph);
    hydrated.sweeperId = sweeperId;
    activeGraph = hydrated;
  } else {
    activeGraph = seedDefaultGraph(sweeperId);
  }

  const color = sweeper.sweepColor;
  refs.swatch.style.color           = color;
  refs.swatch.style.backgroundColor = color;
  refs.sweeperNumEl.textContent     = `Sweeper #${sweeper.id}`;

  // Re-render chip list in case new NodeDefinitions registered since last open.
  refreshToolbox(toolboxHost(refs), toolboxCallbacks());

  // Paint the seeded graph's nodes into the correct columns.
  renderAllNodes();

  // Re-render nodes whenever the graph changes (toolbox drop, cable removal).
  if (graphChangedHandler !== null) refs.root.removeEventListener('graphChanged', graphChangedHandler);
  graphChangedHandler = () => renderAllNodes();
  refs.root.addEventListener('graphChanged', graphChangedHandler);

  // Hydrated / seeded graphs arrive with edges already in the model but no
  // SVG paths painted yet. Fire `graphChanged` so cables.ts's reconciler
  // materializes the missing paths on the next animation frame — node DOM
  // (with port dots) is already in place, so findPortEl() can resolve
  // anchors. Without this, first-open default wiring (distance→frequency,
  // cluster-count→gain) stayed invisible even though codegen worked.
  emitGraphChanged();

  refs.root.classList.remove('hidden');
  refs.root.removeAttribute('aria-hidden');
  refs.root.removeAttribute('inert');
  // Unit 2 — open the shape-options sidebar alongside the editor.
  openSidebar(sweeperId);
  attachKeyHandler();
}

// ── Node-body rendering (Unit 3 overhaul) ────────────────────────────────────
//
// Each node becomes a glass card absolutely-positioned inside the single
// freeform canvas. `card.dataset.side = def.side` drives the color (copper
// for data, coral for sound, amber for sweeper / playback) via CSS attribute
// selectors. Ports carry the `.port` data-attributes Unit 11's cables.ts
// listens for; port labels render inline next to each dot.

let graphChangedHandler: (() => void) | null = null;

function renderAllNodes(): void {
  if (refs === null || activeGraph === null) return;
  // Clear existing node bodies from the single canvas.
  refs.canvas.querySelectorAll(':scope > .ne-node').forEach(n => n.remove());
  let i = 0;
  for (const node of activeGraph.nodes) {
    const def = getNodeDef(node.type);
    if (!def) continue;
    // Assign a sensible default position for freshly-added nodes whose x/y
    // are still zero — lay them out along a diagonal so they don't pile up.
    if (node.x === 0 && node.y === 0) {
      node.x = snapToGrid(48 + (i % 3) * DEFAULT_NODE_WIDTH);
      node.y = snapToGrid(48 + Math.floor(i / 3) * DEFAULT_NODE_HEIGHT);
    }
    refs.canvas.appendChild(renderNode(node, def));
    i += 1;
  }
}

function renderNode(node: Node, def: NodeDefinition): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'ne-node';
  card.dataset['nodeId'] = node.id;
  card.dataset['side']   = def.side;
  card.style.left = `${node.x}px`;
  card.style.top  = `${node.y}px`;
  // Focusable so the panel keydown handler can route Delete/Backspace to
  // the focused chip.
  card.tabIndex = 0;

  const title = document.createElement('div');
  title.className = 'ne-node-title';
  title.textContent = def.label;
  card.appendChild(title);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'ne-node-delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.setAttribute('aria-label', `Delete ${def.label} node`);
  // stopPropagation prevents the card's pointerdown drag handler from firing.
  deleteBtn.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); });
  deleteBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    deleteNodeAndRerender(node.id);
  });
  card.appendChild(deleteBtn);

  // Inputs (top row)
  if (def.inputs && def.inputs.length > 0) {
    const inRow = document.createElement('div');
    inRow.className = 'ne-node-ports ne-node-ports-in';
    for (const p of def.inputs) inRow.appendChild(makePortEl(node, p, 'in'));
    card.appendChild(inRow);
  }

  // Custom UI (slider / select / text)
  if (def.ui) {
    try {
      const ui = def.ui(node, patch => {
        Object.assign(node.params, patch.params ?? {});
        refs?.root.dispatchEvent(new CustomEvent('graphChanged', { bubbles: true }));
      });
      card.appendChild(ui);
    } catch (err) {
      console.warn('[node-editor] ui() threw for', def.type, err);
    }
  }

  // Outputs (bottom row)
  if (def.outputs && def.outputs.length > 0) {
    const outRow = document.createElement('div');
    outRow.className = 'ne-node-ports ne-node-ports-out';
    for (const p of def.outputs) outRow.appendChild(makePortEl(node, p, 'out'));
    card.appendChild(outRow);
  }

  mountDragHandler(card, node);
  return card;
}

function makePortEl(node: Node, port: PortSpec, direction: 'in' | 'out'): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `ne-port-row ne-port-row-${direction}`;

  // Tooltip strings are informational only; codegen never reads these.
  const displayLabel = port.label ?? port.id;
  const rangeSuffix = (port.min != null && port.max != null)
    ? ` (${port.min}–${port.max})`
    : '';
  const unitSuffix = port.unit ? ` in ${port.unit}` : '';
  const shortTip   = `${displayLabel} — ${port.kind}${unitSuffix}${rangeSuffix}`;
  const longTip    = port.description ? `${shortTip}\n${port.description}` : shortTip;

  const dot = document.createElement('div');
  dot.className = 'port';
  dot.dataset['nodeId']    = node.id;
  dot.dataset['portId']    = port.id;
  dot.dataset['direction'] = direction;
  dot.dataset['kind']      = port.kind;
  dot.title                = longTip;

  const label = document.createElement('span');
  label.className = 'port-label';
  label.textContent = `${displayLabel} : ${port.kind}`;
  label.title = longTip;

  const indicator = document.createElement('span');
  indicator.className = 'port-kind-indicator';
  indicator.dataset['kind'] = port.kind;
  indicator.textContent = kindGlyph(port.kind);
  indicator.setAttribute('aria-hidden', 'true');
  indicator.title = shortTip;

  const help = document.createElement('span');
  help.className = 'port-help';
  help.textContent = '?';
  help.setAttribute('aria-label', `About ${displayLabel}`);
  help.title = longTip;

  // Output rows reverse via `flex-direction: row-reverse` in CSS, so the
  // append order here works for both directions.
  row.append(dot, indicator, label, help);
  return row;
}

/** Short single-glyph indicator per port kind. Keep in sync with styles.css. */
function kindGlyph(kind: PortSpec['kind']): string {
  switch (kind) {
    case 'pattern': return '\u25C6'; // ◆
    case 'signal':  return '~';
    case 'trigger': return '!';
    case 'string':  return 'A';
    case 'any':     return '*';
    case 'number':
    default:        return '\u25CF'; // ●
  }
}

/**
 * Install a freeform drag handler on a chip card. Mutates node.x/node.y in
 * memory during drag and snaps to GRID_SNAP_PX on pointerup. Emits
 * `cableReflow` so cables.ts repositions Bézier endpoints without rebuilding
 * the DOM. Deferred-commit: no codegen runs during drag.
 */
function mountDragHandler(card: HTMLDivElement, node: Node): void {
  card.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    // Ports forward to cables.ts; form controls handle their own pointer events.
    if (e.target.closest('.port, button, input, select, textarea')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = node.x;
    const startY = node.y;

    card.classList.add('ne-node-dragging');

    const emitReflow = (): void => {
      if (refs !== null) {
        refs.root.dispatchEvent(new CustomEvent(CABLE_REFLOW_EVENT, { bubbles: true }));
      }
    };

    const onMove = (ev: PointerEvent): void => {
      node.x = Math.max(0, startX + ev.clientX - startClientX);
      node.y = Math.max(0, startY + ev.clientY - startClientY);
      card.style.left = `${node.x}px`;
      card.style.top  = `${node.y}px`;
      emitReflow();
    };

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      window.removeEventListener('pointercancel', onUp);
      node.x = snapToGrid(node.x);
      node.y = snapToGrid(node.y);
      card.style.left = `${node.x}px`;
      card.style.top  = `${node.y}px`;
      card.classList.remove('ne-node-dragging');
      emitReflow();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SNAP_PX) * GRID_SNAP_PX;
}

/**
 * Remove a node from the live graph, re-render chips, and notify listeners
 * so cables.ts drops any incident edges' DOM elements (removeNode already
 * cascaded them out of the graph model).
 *
 * Deferred-commit: no codegen runs here. The compile happens on closeEditor().
 */
function deleteNodeAndRerender(nodeId: string): void {
  if (activeGraph === null) return;
  const removed = removeNode(activeGraph, nodeId);
  if (!removed) return;
  renderAllNodes();
  emitGraphChanged();
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
  // Unit 2 — hide the shape-options sidebar.
  closeSidebar();

  // Unit 14 — DEFERRED COMMIT. Compile the in-memory graph to a full sweeper
  // block, persist the snapshot onto the shape, and hand the fresh block to
  // main.ts's commit callback (which in turn calls telemetry.patchShapeBlock).
  // Codegen runs exactly once here, never during drag/connect.
  const shape = activeSweeperId !== null && resolveSweeper !== null
    ? resolveSweeper(activeSweeperId)
    : null;
  if (shape !== null && activeGraph !== null) {
    shape.graph = graphToSnapshot(activeGraph);
    for (const node of activeGraph.nodes) {
      if (node.type === 'playback.mode') applyPlaybackNode(node, shape);
    }
    const compiled = compileGraphToStrudel(shape.id, activeGraph, shape);
    if (commitGraph !== null) commitGraph(shape, compiled);
  }

  activeSweeperId = null;
  activeGraph     = null;
  detachKeyHandler();
}

// ── Live NodeGraph → persistable NodeGraphSnapshot ───────────────────────────

/**
 * Flatten a live NodeGraph into the serialization-layer NodeGraphSnapshot
 * stored on CanvasShape.graph / ShapeConfig.graph. Drops runtime-only fields
 * (side — recoverable from the NodeDefinition by def type).
 */
function graphToSnapshot(g: NodeGraph): NodeGraphSnapshot {
  return {
    nodes: g.nodes.map(n => ({
      id:      n.id,
      defType: n.type,
      x:       n.x,
      y:       n.y,
      params:  { ...n.params },
    })),
    edges: g.edges.map(e => ({
      id:       e.id,
      fromPort: `${e.from.nodeId}:${e.from.portId}`,
      toPort:   `${e.to.nodeId}:${e.to.portId}`,
    })),
  };
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

  // Pre-attentive "identity chip": color swatch immediately left of the
  // sweeper number, with a soft label underneath. The swatch glows in the
  // sweeper's color so the open panel is visually locked to its target on
  // the canvas.
  //
  // The original "Node Editor" text label is replaced with a panel-toggle
  // icon button — clicking it collapses/expands the shape-options sidebar.
  const titleLabel = document.createElement('button');
  titleLabel.type = 'button';
  titleLabel.className = 'node-editor-title node-editor-sidebar-toggle';
  titleLabel.title = 'Toggle shape options';
  titleLabel.setAttribute('aria-label', 'Toggle shape options');
  titleLabel.setAttribute('aria-expanded', 'true');
  titleLabel.innerHTML = `
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
      <line x1="6.5" y1="3" x2="6.5" y2="13" stroke="currentColor" stroke-width="1.3"/>
    </svg>
  `;
  titleLabel.addEventListener('click', () => {
    const sidebar = document.querySelector('.node-editor-sidebar');
    if (sidebar === null) return;
    const collapsed = sidebar.classList.toggle('collapsed');
    titleLabel.setAttribute('aria-expanded', String(!collapsed));
  });

  const swatch = document.createElement('span');
  swatch.className = 'node-editor-swatch';
  swatch.setAttribute('aria-hidden', 'true');

  const sweeperNumEl = document.createElement('span');
  sweeperNumEl.className = 'node-editor-sweeper-num';
  sweeperNumEl.textContent = 'Sweeper #?';

  const hint = document.createElement('span');
  hint.className = 'node-editor-hint';
  hint.textContent = 'Esc / E to close · Ctrl+Enter to commit';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'node-editor-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close node editor');
  closeBtn.addEventListener('click', closeEditor);

  header.append(titleLabel, swatch, sweeperNumEl, hint, closeBtn);

  // Body ──────────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'node-editor-body';

  // Single freeform canvas (draw.io / Apple Freeform style). Chips float on
  // this surface with absolute positioning; the 24px dot-grid background is
  // applied via CSS. An overlaid SVG hosts the cable layer.
  const canvas = document.createElement('div');
  canvas.className = 'node-editor-canvas';

  const cableLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  cableLayer.setAttribute('class', 'node-editor-cable-layer');
  cableLayer.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  canvas.appendChild(cableLayer);
  body.appendChild(canvas);

  root.append(header, body);
  document.body.appendChild(root);

  refs = {
    root,
    swatch,
    sweeperNumEl,
    closeBtn,
    canvas,
    cableLayer,
  };

  // Toolbox drawer lives along the bottom of the panel.
  mountToolbox(toolboxHost(refs), toolboxCallbacks());

  // Cable drag + connect interactions. Delegated to `root`, so nodes can be
  // added/removed without re-wiring listeners.
  initCables(root, cableLayer);
}

function toolboxHost(r: EditorRefs): { root: HTMLElement; leftCol: HTMLElement; center: HTMLElement; rightCol: HTMLElement } {
  // Unit 3 collapses the three-column layout into a single canvas. The
  // toolbox module still asks for three host elements to decide which
  // column to mark as a drop-target; we point all three at the same canvas
  // so any drop-zone lookup lands inside it and the drop-accepted check
  // always succeeds. Node color comes from def.side (on the chip card), not
  // from which column it was dropped into.
  return { root: r.root, leftCol: r.canvas, center: r.canvas, rightCol: r.canvas };
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

// ── Keyboard: Escape closes (listener is scoped to when panel is open) ───────

function attachKeyHandler(): void {
  if (keyHandler !== null) return;
  keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeEditor();
      return;
    }
    // Delete / Backspace on a focused .ne-node deletes the node + its edges.
    // Edge-selected deletion is owned by cables.ts in its own listener.
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.classList.contains('ne-node')) return;
    const nodeId = active.dataset['nodeId'];
    if (nodeId === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    deleteNodeAndRerender(nodeId);
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

// ── Default-graph seeding (Unit 8) ───────────────────────────────────────────
//
// First-open default wiring that mirrors the pre-overhaul sweeper:
//   data.distance-to-sun ──▶ sound.lpf
//   data.cluster-count   ──▶ sound.gain
//
// Unit 6's data nodes may not be registered yet — we guard every lookup and
// fall back to just the two sound nodes (with their defaultParams) so this
// unit can land independently. Layout (x/y) is filled in by Units 11-13.
//
// TODO(Unit 6/14): spec says "cluster density" for gain; Unit 6 currently
// exposes cluster-count as the closest density sensor. Revisit if Unit 6 ships
// a dedicated density port.

function tryWireDefaultEdge(
  g: NodeGraph,
  fromType: string,
  fromPortId: string,
  toNodeId: string,
  toPortId: string,
): void {
  const fromDef = getNodeDef(fromType);
  if (fromDef === undefined) return;
  const fromNode = addNode(g, { type: fromType, side: 'data', x: 0, y: 0 });
  const outPort = fromDef.outputs?.find(p => p.id === fromPortId) ?? fromDef.outputs?.[0];
  if (outPort === undefined) return;
  try {
    addEdge(g, {
      from: { nodeId: fromNode.id, portId: outPort.id, dir: 'out' },
      to:   { nodeId: toNodeId,    portId: toPortId,   dir: 'in' },
    });
  } catch (err) {
    // Port kinds incompatible — data node stays in the graph but unwired.
    console.warn(`[node-editor] default ${fromType}→${toPortId} wiring skipped:`, err);
  }
}

function seedDefaultGraph(sweeperId: number): NodeGraph {
  const g = createGraph(sweeperId);
  // Default behaviour users see on first open:
  //   data.distance-to-sun  → sound.frequency (exp 100..1000 Hz)
  //   data.cluster-count    → sound.gain      (quadratic 0..1)
  // Since the NodeGraph is the single source of truth for both the editor
  // view AND the Strudel code, this default is reflected consistently in
  // the panel and the running pattern.
  const freq = getNodeDef('sound.frequency')
    ? addNode(g, { type: 'sound.frequency', side: 'sound', x: 0, y: 0 })
    : null;
  const gain = getNodeDef('sound.gain')
    ? addNode(g, { type: 'sound.gain',      side: 'sound', x: 0, y: 0 })
    : null;
  if (freq) tryWireDefaultEdge(g, 'data.distance-to-sun', 'distance', freq.id, 'frequency');
  if (gain) tryWireDefaultEdge(g, 'data.cluster-count',   'count',    gain.id, 'amp');
  return g;
}

/** Test-only: expose the default-graph seeder so the test file can drive it. */
export function _seedDefaultGraphForTests(sweeperId: number): NodeGraph {
  return seedDefaultGraph(sweeperId);
}
