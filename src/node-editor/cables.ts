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

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Compute a quadratic Bézier "M…Q…" path string connecting (ax,ay) → (bx,by)
 * with a control point offset perpendicular to the segment by 40–80px,
 * scaled by distance so short cables stay gentle and long cables swoop.
 *
 * Offset direction is fixed (right-hand normal of the A→B vector), so
 * cables curve consistently regardless of user drag direction. Max-MSP
 * uses downward sag driven by gravity; here we use perpendicular offset
 * to keep vertical + horizontal connections equally legible.
 */
export function pathForEndpoints(ax: number, ay: number, bx: number, by: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector (right-hand normal).
  const nx = -dy / len;
  const ny =  dx / len;
  // Scale: clamp 40..80 by a smooth easing on length.
  const offset = Math.min(80, Math.max(40, len * 0.25));
  const cx = mx + nx * offset;
  const cy = my + ny * offset;
  return `M ${ax.toFixed(2)} ${ay.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${bx.toFixed(2)} ${by.toFixed(2)}`;
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
    if (selectedEdgeEl !== null) selectedEdgeEl.classList.remove('selected');
    selectedEdgeEl = el;
    if (el !== null) el.classList.add('selected');
  };

  const dispatchGraphChanged = (): void => {
    panelRoot.dispatchEvent(new CustomEvent(GRAPH_CHANGED_EVENT, { bubbles: true }));
  };

  const findPortEl = (p: Port): Element | null => {
    const sel = `.port[data-node-id="${p.nodeId}"][data-port-id="${p.portId}"][data-direction="${p.dir}"]`;
    return panelRoot.querySelector(sel);
  };

  // Martian Dusk tokens are applied via CSS (see styles.css); we keep the
  // path element attribute-only so future units can animate `stroke` there.
  const renderEdge = (edge: Edge): SVGPathElement => {
    const path = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
    path.setAttribute('class', 'edge');
    path.setAttribute('data-edge-id', edge.id);
    path.setAttribute('fill', 'none');
    const from = findPortEl(edge.from);
    const to   = findPortEl(edge.to);
    if (from !== null && to !== null) {
      const a = portAnchor(from, svgLayer);
      const b = portAnchor(to,   svgLayer);
      path.setAttribute('d', pathForEndpoints(a.x, a.y, b.x, b.y));
    }
    edgesGroup.appendChild(path);
    return path;
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
    selectedEdgeEl.remove();
    selectEdge(null);
    if (removed) dispatchGraphChanged();
  };

  // ── Wire up listeners (event delegation on panelRoot) ────────────────────
  panelRoot.addEventListener('pointerdown', onPointerDown);
  panelRoot.addEventListener('pointermove', onPointerMove);
  panelRoot.addEventListener('pointerover', onPointerOver);
  panelRoot.addEventListener('pointerout',  onPointerOut);
  panelRoot.addEventListener('pointerup',   onPointerUp);
  panelRoot.addEventListener('click',       onEdgeClick, true);
  panelRoot.addEventListener('keydown',     onKeyDown);

  return (): void => {
    panelRoot.removeEventListener('pointerdown', onPointerDown);
    panelRoot.removeEventListener('pointermove', onPointerMove);
    panelRoot.removeEventListener('pointerover', onPointerOver);
    panelRoot.removeEventListener('pointerout',  onPointerOut);
    panelRoot.removeEventListener('pointerup',   onPointerUp);
    panelRoot.removeEventListener('click',       onEdgeClick, true);
    panelRoot.removeEventListener('keydown',     onKeyDown);
    rootAny[flag] = false;
    if (drag !== null) {
      drag.preview.remove();
      clearHover();
      drag = null;
    }
  };
}
