// src/node-editor/cables.ts
//
// Unit 11 — Cable drag + connect interactions.
//
// Max-MSP-style connecting: pointerdown on a `.port.out` starts a drag; a
// preview quadratic Bézier follows the cursor; pointerover on a `.port.in`
// highlights valid drop-targets; pointerup commits via graph.addEdge.
//
// DEFERRED-COMMIT POLICY
// ──────────────────────
// This unit mutates the in-memory NodeGraph and DOM only. It never touches
// Strudel — Unit 14 handles codegen on closeEditor().
//
// DATA FLOW
// ─────────
// Event delegation on `panelRoot`: ports created by future units (Phase 2)
// "just work" as long as they carry the required data-attributes:
//   - data-node-id      (string)
//   - data-port-id      (string)
//   - data-direction    ('in' | 'out')
//   - data-kind         (PortKind, optional — validation reads the registry)
//
// PUBLIC API
// ──────────
//   initCables(panelRoot, svgLayer)           → Disposer
//   GRAPH_CHANGED_EVENT                       → event name constant
//   pathForEndpoints(ax, ay, bx, by)          → SVG path string (testable)
//
// Dispatches a bubbling `graphChanged` CustomEvent on `panelRoot` whenever
// the graph mutates (edge added or removed). Listeners are responsible for
// any re-render / re-layout work; this module only redraws its own edges.

import { addEdge, canAddEdge, removeEdge } from './graph';
import { currentGraph } from './panel';
import type { Edge, NodeGraph, Port, PortDirection } from './types';

// ── Public constants ─────────────────────────────────────────────────────────

export const GRAPH_CHANGED_EVENT = 'graphChanged';

/** Bubbling event fired while a node is being dragged — asks cables to reflow
 *  without rebuilding the DOM (cheap, per-frame). */
export const CABLE_REFLOW_EVENT = 'cableReflow';

// Module-local flag read by hasSelectedEdge(); updated by every initCables
// instance as the user clicks edges + presses Backspace. Unit 5's worker
// uses this to avoid swallowing Backspace when nothing is selected.
let _hasSelectedEdge = false;

/**
 * True iff the currently-open node editor has an edge in its "selected"
 * state. Unit 5's global Backspace handler uses this to decide whether to
 * preventDefault and delete the edge, or to let the keystroke fall through
 * to other consumers (shape deletion, for example).
 */
export function hasSelectedEdge(): boolean { return _hasSelectedEdge; }

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Quadratic Bézier control point perpendicular to A→B, offset 40–80px by
 * segment length. Right-hand normal so cables curve consistently regardless
 * of drag direction.
 */
function controlPoint(ax: number, ay: number, bx: number, by: number): { cx: number; cy: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const offset = Math.min(80, Math.max(40, len * 0.25));
  return {
    cx: (ax + bx) / 2 + (-dy / len) * offset,
    cy: (ay + by) / 2 + ( dx / len) * offset,
  };
}

/** Compute a quadratic Bézier "M…Q…" path string connecting A → B. */
export function pathForEndpoints(ax: number, ay: number, bx: number, by: number): string {
  const { cx, cy } = controlPoint(ax, ay, bx, by);
  return `M ${ax.toFixed(2)} ${ay.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${bx.toFixed(2)} ${by.toFixed(2)}`;
}

/** Midpoint of the quadratic Bézier used by pathForEndpoints (t=0.5). */
function bezierMidpoint(ax: number, ay: number, bx: number, by: number): { x: number; y: number } {
  const { cx, cy } = controlPoint(ax, ay, bx, by);
  return { x: 0.25 * ax + 0.5 * cx + 0.25 * bx, y: 0.25 * ay + 0.5 * cy + 0.25 * by };
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

type Disposer = () => void;

interface PortDescriptor {
  el:    Element;
  nodeId:    string;
  portId:    string;
  direction: PortDirection;
}

function readPort(el: Element | null): PortDescriptor | null {
  if (el === null) return null;
  if (!el.classList || !el.classList.contains('port')) return null;
  const nodeId    = el.getAttribute('data-node-id');
  const portId    = el.getAttribute('data-port-id');
  const direction = el.getAttribute('data-direction') as PortDirection | null;
  if (nodeId === null || portId === null) return null;
  if (direction !== 'in' && direction !== 'out') return null;
  return { el, nodeId, portId, direction };
}

/** Find the `.port` ancestor (or self) of the given node. */
function closestPort(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const closest = (target as Element & { closest?: (sel: string) => Element | null }).closest;
  if (typeof closest === 'function') return closest.call(target, '.port');
  // Fallback walk for older/mock environments.
  let cur: Element | null = target;
  while (cur !== null) {
    if (cur.classList && cur.classList.contains('port')) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Compute the port's anchor point in the local SVG coordinate system.
 * We reuse getBoundingClientRect on both the port and the SVG layer so the
 * anchor tracks any resize/scroll/transform the panel might do.
 */
function portAnchor(portEl: Element, svg: SVGSVGElement): { x: number; y: number } {
  const pr = portEl.getBoundingClientRect();
  const sr = svg.getBoundingClientRect();
  return {
    x: pr.left - sr.left + pr.width / 2,
    y: pr.top  - sr.top  + pr.height / 2,
  };
}

function pointerInSvg(e: PointerEvent, svg: SVGSVGElement): { x: number; y: number } {
  const sr = svg.getBoundingClientRect();
  return { x: e.clientX - sr.left, y: e.clientY - sr.top };
}

// ── Public: wire up the panel ───────────────────────────────────────────────

export interface InitCablesOpts {
  /**
   * Override the active graph resolver. Defaults to `panel.currentGraph()`,
   * which is the production wiring. Tests inject a fixture graph directly.
   */
  getGraph?: () => NodeGraph | null;
}

/**
 * Install cable-drag handlers on `panelRoot`, rendering previews + committed
 * edges into `svgLayer`. Returns a disposer that tears everything down.
 *
 * Idempotent per-element: calling twice on the same root short-circuits the
 * second call (no double-bound listeners).
 */
export function initCables(
  panelRoot: HTMLElement,
  svgLayer: SVGSVGElement,
  opts: InitCablesOpts = {},
): Disposer {
  const getGraph = opts.getGraph ?? currentGraph;
  const flag = '__cablesInit';
  const rootAny = panelRoot as HTMLElement & Record<string, boolean | undefined>;
  if (rootAny[flag]) return () => { /* already initialized — caller keeps the first disposer */ };
  rootAny[flag] = true;

  // ── Persistent edges layer ───────────────────────────────────────────────
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let edgesGroup = svgLayer.querySelector<SVGGElement>('g#edges');
  if (edgesGroup === null) {
    edgesGroup = document.createElementNS(SVG_NS, 'g');
    edgesGroup.setAttribute('id', 'edges');
    svgLayer.appendChild(edgesGroup);
  }
  // Edges must receive pointer events so they can be clicked/selected,
  // even if the parent <svg> is pointer-events: none for cable-drag routing.
  edgesGroup.setAttribute('pointer-events', 'auto');

  // ── Drag-session state ───────────────────────────────────────────────────
  interface DragState {
    source:     PortDescriptor;
    sourceXY:  { x: number; y: number };
    preview:   SVGPathElement;
    hovered:   Element | null;    // current in-port under cursor, if highlighted
  }
  let drag: DragState | null = null;

  // ── Selection state for existing edges ──────────────────────────────────
  let selectedEdgeEl: SVGPathElement | null = null;
  const selectEdge = (el: SVGPathElement | null): void => {
    if (selectedEdgeEl !== null) {
      selectedEdgeEl.classList.remove('selected');
      const oldBtn = findDeleteBtn(selectedEdgeEl);
      if (oldBtn !== null) oldBtn.classList.remove('is-visible');
    }
    selectedEdgeEl = el;
    _hasSelectedEdge = el !== null;
    if (el !== null) {
      el.classList.add('selected');
      const btn = findDeleteBtn(el);
      if (btn !== null) btn.classList.add('is-visible');
    }
  };

  const dispatchGraphChanged = (): void => {
    panelRoot.dispatchEvent(new CustomEvent(GRAPH_CHANGED_EVENT, { bubbles: true }));
  };

  const findPortEl = (p: Port): Element | null => {
    const sel = `.port[data-node-id="${p.nodeId}"][data-port-id="${p.portId}"][data-direction="${p.dir}"]`;
    return panelRoot.querySelector(sel);
  };

  // Find the sibling `.edge-delete-btn` associated with a path. Stored as
  // data-edge-id on the button so renderEdge + reflow can address it directly
  // without walking the DOM.
  const findDeleteBtn = (path: SVGPathElement): HTMLButtonElement | null => {
    const edgeId = path.getAttribute('data-edge-id');
    if (edgeId === null) return null;
    return panelRoot.querySelector<HTMLButtonElement>(
      `.edge-delete-btn[data-edge-id="${edgeId}"]`,
    );
  };

  // Overlay layer for HTML × buttons. Lives on panelRoot so it renders above
  // the SVG cable layer and receives pointer events normally.
  let overlay = panelRoot.querySelector<HTMLDivElement>(':scope > .node-editor-edge-overlay');
  if (overlay === null) {
    overlay = document.createElement('div');
    overlay.className = 'node-editor-edge-overlay';
    panelRoot.appendChild(overlay);
  }

  const overlayOrigin = (): { left: number; top: number } => {
    const sr = svgLayer.getBoundingClientRect();
    const pr = panelRoot.getBoundingClientRect();
    return { left: sr.left - pr.left, top: sr.top - pr.top };
  };

  // Position the × button at the current Bézier midpoint of its edge. Called
  // after renderEdge and on every cableReflow.
  const positionDeleteBtn = (btn: HTMLButtonElement, ax: number, ay: number, bx: number, by: number): void => {
    const mid = bezierMidpoint(ax, ay, bx, by);
    const o = overlayOrigin();
    btn.style.left = `${o.left + mid.x}px`;
    btn.style.top  = `${o.top  + mid.y}px`;
  };

  // Martian Dusk tokens are applied via CSS (see styles.css); we keep the
  // path element attribute-only so future units can animate `stroke` there.
  const renderEdge = (edge: Edge): SVGPathElement => {
    const path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    path.setAttribute('class', 'edge');
    path.setAttribute('data-edge-id', edge.id);
    path.setAttribute('fill', 'none');

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'edge-delete-btn';
    deleteBtn.dataset['edgeId'] = edge.id;
    deleteBtn.textContent = '×';
    deleteBtn.setAttribute('aria-label', 'Delete cable');

    const from = findPortEl(edge.from);
    const to   = findPortEl(edge.to);
    if (from !== null && to !== null) {
      const a = portAnchor(from, svgLayer);
      const b = portAnchor(to,   svgLayer);
      path.setAttribute('d', pathForEndpoints(a.x, a.y, b.x, b.y));
      positionDeleteBtn(deleteBtn, a.x, a.y, b.x, b.y);
    }

    deleteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const g = getGraph();
      if (g === null) return;
      const removed = removeEdge(g, edge.id);
      if (selectedEdgeEl === path) selectEdge(null);
      path.remove();
      deleteBtn.remove();
      if (removed) dispatchGraphChanged();
    });

    // Reveal × on edge hover. SVG→HTML isn't a CSS cascade path, so toggle
    // via JS. Selection also reveals (see selectEdge).
    path.addEventListener('pointerenter', () => deleteBtn.classList.add('is-visible'));
    path.addEventListener('pointerleave', () => {
      // Keep visible if the edge is selected or if the pointer moved onto
      // the button itself (its own :hover state will keep it visible).
      if (selectedEdgeEl !== path) deleteBtn.classList.remove('is-visible');
    });

    edgesGroup.appendChild(path);
    overlay.appendChild(deleteBtn);
    return path;
  };

  /** Recompute every existing edge's `d` + × position against current DOM
   *  anchors. Called on node drag (`cableReflow`) and after graph mutations
   *  that might have shifted endpoints. Cheap — no DOM churn.
   *
   *  Also prunes orphaned SVG paths + × buttons whose edge was removed from
   *  the graph (e.g. via node deletion cascading through removeNode). Without
   *  this, deleted cables would remain visually until the panel re-rendered. */
  const reflowAllEdges = (): void => {
    const paths = edgesGroup.querySelectorAll<SVGPathElement>('.edge');
    const g = getGraph();
    paths.forEach((path) => {
      const edgeId = path.getAttribute('data-edge-id');
      if (edgeId === null) return;
      const edge = g?.edges.find(e => e.id === edgeId);
      if (edge === undefined) {
        // Graph no longer has this edge — drop the stale DOM bits.
        const btn = findDeleteBtn(path);
        if (btn !== null) btn.remove();
        if (selectedEdgeEl === path) selectEdge(null);
        path.remove();
        return;
      }
      const from = findPortEl(edge.from);
      const to   = findPortEl(edge.to);
      if (from === null || to === null) return;
      const a = portAnchor(from, svgLayer);
      const b = portAnchor(to,   svgLayer);
      path.setAttribute('d', pathForEndpoints(a.x, a.y, b.x, b.y));
      const btn = findDeleteBtn(path);
      if (btn !== null) positionDeleteBtn(btn, a.x, a.y, b.x, b.y);
    });
  };

  // ── Pointer handlers ─────────────────────────────────────────────────────

  const onPointerDown = (e: Event): void => {
    const pe = e as PointerEvent;
    const portEl = closestPort(pe.target);
    const desc = readPort(portEl);
    if (desc === null) return;
    if (desc.direction !== 'out') return;

    // Starting a new drag cancels any edge selection.
    selectEdge(null);

    const sourceXY = portAnchor(desc.el, svgLayer);

    const preview = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    preview.setAttribute('class', 'edge edge-preview');
    preview.setAttribute('fill', 'none');
    preview.setAttribute('stroke-dasharray', '4 3');
    preview.setAttribute('d', pathForEndpoints(sourceXY.x, sourceXY.y, sourceXY.x, sourceXY.y));
    svgLayer.appendChild(preview);

    drag = { source: desc, sourceXY, preview, hovered: null };
    pe.preventDefault();
  };

  const onPointerMove = (e: Event): void => {
    if (drag === null) return;
    const pe = e as PointerEvent;
    const { x, y } = pointerInSvg(pe, svgLayer);
    drag.preview.setAttribute('d', pathForEndpoints(drag.sourceXY.x, drag.sourceXY.y, x, y));
  };

  const clearHover = (): void => {
    if (drag !== null && drag.hovered !== null) {
      drag.hovered.classList.remove('valid-target');
      drag.hovered = null;
    }
  };

  const onPointerOver = (e: Event): void => {
    if (drag === null) return;
    const pe = e as PointerEvent;
    const portEl = closestPort(pe.target);
    const desc = readPort(portEl);
    if (desc === null || desc.direction !== 'in') {
      clearHover();
      return;
    }

    const g = getGraph();
    if (g === null) {
      clearHover();
      return;
    }

    const candidate = {
      from: { nodeId: drag.source.nodeId, portId: drag.source.portId, dir: 'out' as const },
      to:   { nodeId: desc.nodeId,        portId: desc.portId,        dir: 'in'  as const },
    };

    if (!canAddEdge(g, candidate)) {
      clearHover();
      return;
    }

    if (drag.hovered !== desc.el) {
      clearHover();
      desc.el.classList.add('valid-target');
      drag.hovered = desc.el;
    }
  };

  const onPointerOut = (e: Event): void => {
    if (drag === null) return;
    const pe = e as PointerEvent;
    const portEl = closestPort(pe.target);
    if (portEl !== null && portEl === drag.hovered) {
      clearHover();
    }
  };

  const endDrag = (commitTo: PortDescriptor | null): void => {
    if (drag === null) return;
    const g = getGraph();
    const preview = drag.preview;
    const source = drag.source;
    clearHover();
    preview.remove();
    drag = null;

    if (commitTo === null || g === null) return;

    const candidate = {
      from: { nodeId: source.nodeId,    portId: source.portId,    dir: 'out' as const },
      to:   { nodeId: commitTo.nodeId,  portId: commitTo.portId,  dir: 'in'  as const },
    };
    if (!canAddEdge(g, candidate)) return;

    try {
      const edge = addEdge(g, candidate);
      renderEdge(edge);
      dispatchGraphChanged();
    } catch {
      // Defensive: canAddEdge should have screened this. Swallow.
    }
  };

  const onPointerUp = (e: Event): void => {
    if (drag === null) return;
    const pe = e as PointerEvent;
    const portEl = closestPort(pe.target);
    const desc = readPort(portEl);
    const target = (desc !== null && desc.direction === 'in') ? desc : null;
    endDrag(target);
  };

  // ── Edge selection / deletion ────────────────────────────────────────────

  const onEdgeClick = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const edgeEl = target.classList.contains('edge') && !target.classList.contains('edge-preview')
      ? (target as SVGPathElement)
      : null;
    if (edgeEl === null) return;
    e.stopPropagation();
    selectEdge(selectedEdgeEl === edgeEl ? null : edgeEl);
  };

  // Only intercept Backspace/Delete when an edge is actually selected. This
  // prevents the editor from stealing the key from outside consumers (e.g.
  // shape deletion) when the panel is open but no cable is selected. The
  // listener is scoped to `panelRoot`, not `document`, so it only fires
  // when focus / pointer is inside the editor.
  const onKeyDown = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.key !== 'Delete' && ke.key !== 'Backspace') return;
    if (selectedEdgeEl === null) return;
    const g = getGraph();
    if (g === null) return;
    const edgeId = selectedEdgeEl.getAttribute('data-edge-id');
    if (edgeId === null) return;
    ke.preventDefault();
    const removed = removeEdge(g, edgeId);
    const btn = findDeleteBtn(selectedEdgeEl);
    if (btn !== null) btn.remove();
    selectedEdgeEl.remove();
    selectEdge(null);
    if (removed) dispatchGraphChanged();
  };

  // rAF-coalesce reflows: pointermove can fire faster than the display
  // refresh, so we batch into a single DOM walk per frame.
  let reflowScheduled = false;
  const scheduleReflow = (): void => {
    if (reflowScheduled) return;
    reflowScheduled = true;
    requestAnimationFrame(() => {
      reflowScheduled = false;
      reflowAllEdges();
    });
  };
  const onCableReflow  = (): void => { scheduleReflow(); };
  const onGraphChanged = (): void => { scheduleReflow(); };

  // ── Wire up listeners (event delegation on panelRoot) ────────────────────
  panelRoot.addEventListener('pointerdown', onPointerDown);
  panelRoot.addEventListener('pointermove', onPointerMove);
  panelRoot.addEventListener('pointerover', onPointerOver);
  panelRoot.addEventListener('pointerout',  onPointerOut);
  panelRoot.addEventListener('pointerup',   onPointerUp);
  panelRoot.addEventListener('click',       onEdgeClick, true);
  panelRoot.addEventListener('keydown',     onKeyDown);
  panelRoot.addEventListener(CABLE_REFLOW_EVENT,  onCableReflow);
  panelRoot.addEventListener(GRAPH_CHANGED_EVENT, onGraphChanged);

  return (): void => {
    panelRoot.removeEventListener('pointerdown', onPointerDown);
    panelRoot.removeEventListener('pointermove', onPointerMove);
    panelRoot.removeEventListener('pointerover', onPointerOver);
    panelRoot.removeEventListener('pointerout',  onPointerOut);
    panelRoot.removeEventListener('pointerup',   onPointerUp);
    panelRoot.removeEventListener('click',       onEdgeClick, true);
    panelRoot.removeEventListener('keydown',     onKeyDown);
    panelRoot.removeEventListener(CABLE_REFLOW_EVENT,  onCableReflow);
    panelRoot.removeEventListener(GRAPH_CHANGED_EVENT, onGraphChanged);
    rootAny[flag] = false;
    _hasSelectedEdge = false;
    if (drag !== null) {
      drag.preview.remove();
      clearHover();
      drag = null;
    }
  };
}
