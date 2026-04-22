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

import type { NodeGraphSnapshot } from '../config-snapshot';
import type { CanvasShape } from '../shapes';
import { initCables } from './cables';
import { addEdge, addNode, createGraph } from './graph';
import { getNodeDef } from './registry';
import { mountToolbox, refreshToolbox } from './toolbox';
import type { NodeGraph } from './types';
// Side-effect import: registers the four sound-basic NodeDefinitions so the
// default-graph seeding below can find them via getNodeDef().
import './nodes/sound-basic';

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

  // Unit 8: if the sweeper has no saved graph yet, seed the default wiring
  // (distance → lpf, cluster-count → gain) that mirrors the pre-overhaul
  // behaviour so audio never drops out when a sweeper first spawns.
  //
  // TODO(Unit 14): hydrate from `sweeper.graph` (NodeGraphSnapshot) when it is
  // present, so saved scenes round-trip through the editor. For now we always
  // seed a fresh default when we see no snapshot.
  activeGraph = sweeper.graph === null
    ? seedDefaultGraph(sweeperId)
    : createGraph(sweeperId);

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

  // Persist the in-memory graph back to sweeper.graph (Unit 5's
  // NodeGraphSnapshot field) so subsequent opens reuse it and save/load
  // carries it through. TODO(Unit 14): the snapshot conversion + codegen
  // hook will both plug in here.
  if (activeGraph !== null && activeSweeperId !== null && resolveSweeper !== null) {
    const sweeper = resolveSweeper(activeSweeperId);
    if (sweeper !== null) {
      sweeper.graph = snapshotFromGraph(activeGraph);
    }
  }

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

  // Unit 11: cable drag + connect interactions. Attaches delegated pointer
  // handlers to `root`, so future units can add ports without re-wiring.
  initCables(root, cableLayer);
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
  const lpf  = addNode(g, { type: 'sound.lpf',  side: 'sound', x: 0, y: 0 });
  const gain = addNode(g, { type: 'sound.gain', side: 'sound', x: 0, y: 0 });
  tryWireDefaultEdge(g, 'data.distance-to-sun', 'distance', lpf.id,  'frequency');
  tryWireDefaultEdge(g, 'data.cluster-count',   'count',    gain.id, 'amp');
  return g;
}

/**
 * Serialize a live NodeGraph to the on-disk NodeGraphSnapshot shape. Minimal
 * projection that preserves identity + params + edge port endpoints.
 * TODO(Unit 14): align this with the richer snapshot format once codegen
 * finalises which fields round-trip.
 */
function snapshotFromGraph(g: NodeGraph): NodeGraphSnapshot {
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

/** Test-only: expose the default-graph seeder so the test file can drive it. */
export function _seedDefaultGraphForTests(sweeperId: number): NodeGraph {
  return seedDefaultGraph(sweeperId);
}
