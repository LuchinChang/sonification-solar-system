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
import { compileGraphToStrudel } from './codegen';
import { addEdge, addNode, createGraph } from './graph';
import { getNodeDef } from './registry';
import { mountToolbox, refreshToolbox } from './toolbox';
import type { Node, NodeDefinition, NodeGraph } from './types';
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
  refs.swatch.style.color           = color;
  refs.swatch.style.backgroundColor = color;
  refs.sweeperIcon.style.color      = color;
  refs.sweeperNumEl.textContent     = `Sweeper #${sweeper.id}`;

  // Re-render chip list in case new NodeDefinitions registered since last open.
  refreshToolbox(toolboxHost(refs), toolboxCallbacks());

  // Paint the seeded graph's nodes into the correct columns.
  renderAllNodes();

  // Re-render nodes whenever the graph changes (toolbox drop, cable removal).
  if (graphChangedHandler !== null) refs.root.removeEventListener('graphChanged', graphChangedHandler);
  graphChangedHandler = () => renderAllNodes();
  refs.root.addEventListener('graphChanged', graphChangedHandler);

  refs.root.classList.remove('hidden');
  refs.root.removeAttribute('aria-hidden');
  refs.root.removeAttribute('inert');
  attachKeyHandler();
}

// ── Node-body rendering (Phase-2 integration) ────────────────────────────────
//
// Each node becomes a glass card inside its side's column. Ports on the left
// edge (inputs) and right edge (outputs) carry the `.port` data-attributes
// Unit 11's cables.ts listens for, so dragging works end-to-end.

let graphChangedHandler: (() => void) | null = null;

function renderAllNodes(): void {
  if (refs === null || activeGraph === null) return;
  // Clear existing node bodies (keep column title + placeholder).
  for (const col of [refs.leftCol, refs.rightCol, refs.center]) {
    col.querySelectorAll(':scope > .ne-node').forEach(n => n.remove());
  }
  for (const node of activeGraph.nodes) {
    const def = getNodeDef(node.type);
    if (!def) continue;
    const host = columnForSide(def.side);
    if (host !== null) host.appendChild(renderNode(node, def));
  }
}

function columnForSide(side: 'data' | 'sweeper' | 'sound' | 'playback'): HTMLElement | null {
  if (refs === null) return null;
  if (side === 'data')  return refs.leftCol;
  if (side === 'sound') return refs.rightCol;
  return refs.center;  // sweeper + playback share center
}

function renderNode(node: Node, def: NodeDefinition): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'ne-node';
  card.dataset['nodeId'] = node.id;

  const title = document.createElement('div');
  title.className = 'ne-node-title';
  title.textContent = def.label;
  card.appendChild(title);

  // Inputs (left edge)
  if (def.inputs && def.inputs.length > 0) {
    const inRow = document.createElement('div');
    inRow.className = 'ne-node-ports ne-node-ports-in';
    for (const p of def.inputs) inRow.appendChild(makePortEl(node, p, 'in'));
    card.appendChild(inRow);
  }

  // Custom UI (slider / select / text — Unit 7/8/9/10)
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

  // Outputs (right edge)
  if (def.outputs && def.outputs.length > 0) {
    const outRow = document.createElement('div');
    outRow.className = 'ne-node-ports ne-node-ports-out';
    for (const p of def.outputs) outRow.appendChild(makePortEl(node, p, 'out'));
    card.appendChild(outRow);
  }

  return card;
}

function makePortEl(node: Node, port: { id: string; label?: string; kind: string }, direction: 'in' | 'out'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'port';
  el.dataset['nodeId']   = node.id;
  el.dataset['portId']   = port.id;
  el.dataset['direction'] = direction;
  el.dataset['kind']     = port.kind;
  el.title                = `${port.label ?? port.id} (${port.kind})`;
  return el;
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

  // Unit 14 — DEFERRED COMMIT. Compile the in-memory graph to a full sweeper
  // block, persist the snapshot onto the shape, and hand the fresh block to
  // main.ts's commit callback (which in turn calls telemetry.patchShapeBlock).
  // Codegen runs exactly once here, never during drag/connect.
  const shape = activeSweeperId !== null && resolveSweeper !== null
    ? resolveSweeper(activeSweeperId)
    : null;
  if (shape !== null && activeGraph !== null) {
    shape.graph = graphToSnapshot(activeGraph);
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
  const titleLabel = document.createElement('span');
  titleLabel.className = 'node-editor-title';
  titleLabel.textContent = 'Node Editor';

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
  // Gracefully skip missing defs: tests that reset the registry can still
  // exercise openEditor/closeEditor without re-registering the full sound-basic
  // suite. Production code imports './nodes/sound-basic' side-effect at module
  // load, so the defs are always present there.
  const lpf  = getNodeDef('sound.lpf')
    ? addNode(g, { type: 'sound.lpf',  side: 'sound', x: 0, y: 0 })
    : null;
  const gain = getNodeDef('sound.gain')
    ? addNode(g, { type: 'sound.gain', side: 'sound', x: 0, y: 0 })
    : null;
  if (lpf)  tryWireDefaultEdge(g, 'data.distance-to-sun', 'distance', lpf.id,  'frequency');
  if (gain) tryWireDefaultEdge(g, 'data.cluster-count',   'count',    gain.id, 'amp');
  return g;
}

/** Test-only: expose the default-graph seeder so the test file can drive it. */
export function _seedDefaultGraphForTests(sweeperId: number): NodeGraph {
  return seedDefaultGraph(sweeperId);
}
