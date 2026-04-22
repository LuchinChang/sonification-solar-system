// src/node-editor/toolbox.ts
//
// Unit 13 — Max-MSP-style toolbox drawer.
//
// Renders a horizontal drawer along the bottom of the node editor panel,
// showing one chip per registered NodeDefinition. The user drags a chip
// into the panel; if the cursor releases over a column whose `side`
// matches the chip's `side`, a new Node is added to the active graph at
// the cursor position and a short "poof" ripple plays.
//
// Pure separation:
//   - groupDefsBySide / resolveDropZone / shouldReduceMotion are pure
//     helpers, testable without a DOM.
//   - mountToolbox wires everything into a live panel.
//
// Intentionally does NOT:
//   - hardcode the node list (always queries listNodeDefs())
//   - mint edges (Unit 11 owns that)
//   - compile Strudel (deferred until panel close; Unit 14)

import { addNode } from './graph';
import { listNodeDefs } from './registry';
import type { NodeDefinition, NodeGraph, NodeSide } from './types';

// ── Side → column mapping ────────────────────────────────────────────────────
//
// The panel only has three visible columns, but there are four sides. Sweeper
// and playback nodes both live on the center rail with the sweeper icon.

export type EditorColumn = 'left' | 'center' | 'right';

export function columnForSide(side: NodeSide): EditorColumn {
  switch (side) {
    case 'data':     return 'left';
    case 'sound':    return 'right';
    case 'sweeper':
    case 'playback': return 'center';
  }
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** Group definitions by their declared `side`, preserving registration order. */
export function groupDefsBySide(
  defs: readonly NodeDefinition[],
): Record<NodeSide, NodeDefinition[]> {
  const out: Record<NodeSide, NodeDefinition[]> = {
    data:     [],
    sweeper:  [],
    sound:    [],
    playback: [],
  };
  for (const d of defs) out[d.side].push(d);
  return out;
}

/** Display order of side groups inside the drawer. */
export const SIDE_ORDER: readonly NodeSide[] = ['data', 'sweeper', 'sound', 'playback'];

/** Drop-zone lookup: given the zone rects and a pointer position, pick a matching column. */
export interface ZoneRect {
  column: EditorColumn;
  left:   number;
  top:    number;
  right:  number;
  bottom: number;
}

/** Returns the column whose rect contains (x,y), or null if none. */
export function resolveDropZone(zones: readonly ZoneRect[], x: number, y: number): EditorColumn | null {
  for (const z of zones) {
    if (x >= z.left && x <= z.right && y >= z.top && y <= z.bottom) return z.column;
  }
  return null;
}

/** Would the chip drop at (x,y) accept a node of `side`? */
export function isDropAccepted(
  zones: readonly ZoneRect[],
  side: NodeSide,
  x: number,
  y: number,
): boolean {
  const zone = resolveDropZone(zones, x, y);
  return zone !== null && zone === columnForSide(side);
}

/** Respect prefers-reduced-motion for the ripple "poof". */
export function shouldReduceMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ── DOM mounting ────────────────────────────────────────────────────────────

export interface ToolboxHost {
  /** The panel root — ripples are appended here so they sit over everything. */
  root:     HTMLElement;
  /** Data-side column (side === 'data'). */
  leftCol:  HTMLElement;
  /** Sweeper + playback column (center rail containing the sweeper icon). */
  center:   HTMLElement;
  /** Sound-side column (side === 'sound'). */
  rightCol: HTMLElement;
}

export interface ToolboxCallbacks {
  /** Returns the currently-open graph, or null if the panel has nothing loaded. */
  getGraph:       () => NodeGraph | null;
  /** Fires after a successful addNode, so the panel can re-render + emit events. */
  onGraphChanged: () => void;
  /** Test seam: lets tests assert drops without a real addNode. */
  addNodeFn?:     typeof addNode;
}

/**
 * Mount the drawer inside the panel. Must be called from within
 * ensureMounted(); idempotent if the drawer is already present.
 */
export function mountToolbox(host: ToolboxHost, cb: ToolboxCallbacks): HTMLElement {
  const existing = host.root.querySelector<HTMLElement>('.ne-toolbox');
  if (existing) return existing;

  const drawer = document.createElement('div');
  drawer.className = 'ne-toolbox';
  drawer.setAttribute('role', 'toolbar');
  drawer.setAttribute('aria-label', 'Node toolbox');

  renderChips(drawer, host, cb);
  host.root.appendChild(drawer);
  return drawer;
}

/** Wipe-and-re-render the chip list. Called on mount and whenever the registry could have grown. */
export function refreshToolbox(host: ToolboxHost, cb: ToolboxCallbacks): void {
  const drawer = host.root.querySelector<HTMLElement>('.ne-toolbox');
  if (!drawer) return;
  drawer.replaceChildren();
  renderChips(drawer, host, cb);
}

/** Sides that the toolbox drawer exposes as draggable chips. Unit 2 — shape-
 *  specific 'sweeper' and 'playback' sides live in the left sidebar, not the
 *  toolbox, because they can't be connected via cables. */
const TOOLBOX_SIDES: ReadonlySet<NodeSide> = new Set<NodeSide>(['data', 'sound']);

function renderChips(drawer: HTMLElement, host: ToolboxHost, cb: ToolboxCallbacks): void {
  const defs = listNodeDefs().filter(d => TOOLBOX_SIDES.has(d.side));
  if (defs.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'ne-toolbox-empty';
    empty.textContent = 'No node types registered yet.';
    drawer.appendChild(empty);
    return;
  }

  const grouped = groupDefsBySide(defs);
  for (const side of SIDE_ORDER) {
    const sideDefs = grouped[side];
    if (sideDefs.length === 0) continue;

    const group = document.createElement('div');
    group.className = 'ne-toolbox-group';
    group.dataset.side = side;

    const label = document.createElement('span');
    label.className = 'ne-toolbox-group-label';
    label.textContent = side.toUpperCase();
    group.appendChild(label);

    for (const def of sideDefs) group.appendChild(buildChip(def, host, cb));
    drawer.appendChild(group);
  }
}

function buildChip(def: NodeDefinition, host: ToolboxHost, cb: ToolboxCallbacks): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'ne-toolbox-chip';
  chip.dataset.side = def.side;
  chip.dataset.type = def.type;
  chip.textContent = def.label;
  chip.setAttribute('aria-label', `Add ${def.label} node (${def.side})`);

  chip.addEventListener('pointerdown', (ev) => startDrag(ev, def, host, cb, chip));
  return chip;
}

// ── Drag lifecycle ──────────────────────────────────────────────────────────

function startDrag(
  ev: PointerEvent,
  def: NodeDefinition,
  host: ToolboxHost,
  cb: ToolboxCallbacks,
  chip: HTMLElement,
): void {
  if (ev.button !== 0) return;
  ev.preventDefault();

  // Ghost element that follows the cursor.
  const ghost = document.createElement('div');
  ghost.className = 'ne-toolbox-ghost';
  ghost.dataset.side = def.side;
  ghost.textContent = def.label;
  ghost.style.left = `${ev.clientX}px`;
  ghost.style.top  = `${ev.clientY}px`;
  document.body.appendChild(ghost);

  // Mark the matching column so the user gets visual feedback.
  const targetCol = targetColumnEl(host, def.side);
  if (targetCol) targetCol.classList.add('ne-drop-target');

  const onMove = (e: PointerEvent): void => {
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top  = `${e.clientY}px`;
    ghost.classList.toggle('is-valid', isDropAccepted(snapshotZones(host), def.side, e.clientX, e.clientY));
  };

  const onUp = (e: PointerEvent): void => {
    cleanup();
    if (!isDropAccepted(snapshotZones(host), def.side, e.clientX, e.clientY)) {
      bounceBackChip(chip);
      return;
    }

    const graph = cb.getGraph();
    if (!graph) {
      bounceBackChip(chip);
      return;
    }

    // Compute drop point relative to the matching column so the node's (x,y) is column-local.
    const colEl = targetColumnEl(host, def.side);
    const rect  = colEl?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : e.clientX;
    const y = rect ? e.clientY - rect.top  : e.clientY;

    const addFn = cb.addNodeFn ?? addNode;
    try {
      addFn(graph, { type: def.type, side: def.side, x, y });
    } catch (err) {
      console.warn('[toolbox] addNode failed', err);
      bounceBackChip(chip);
      return;
    }

    spawnPoof(host.root, e.clientX, e.clientY);
    cb.onGraphChanged();
  };

  const cleanup = (): void => {
    window.removeEventListener('pointermove',   onMove);
    window.removeEventListener('pointerup',     onUp);
    window.removeEventListener('pointercancel', onCancel);
    ghost.remove();
    if (targetCol) targetCol.classList.remove('ne-drop-target');
  };

  const onCancel = (): void => { cleanup(); bounceBackChip(chip); };

  window.addEventListener('pointermove',   onMove);
  window.addEventListener('pointerup',     onUp);
  window.addEventListener('pointercancel', onCancel);
}

function targetColumnEl(host: ToolboxHost, side: NodeSide): HTMLElement | null {
  switch (columnForSide(side)) {
    case 'left':   return host.leftCol;
    case 'right':  return host.rightCol;
    case 'center': return host.center;
  }
}

function snapshotZones(host: ToolboxHost): ZoneRect[] {
  const zones: ZoneRect[] = [];
  const push = (el: HTMLElement | null, column: EditorColumn): void => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    zones.push({ column, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  };
  push(host.leftCol,  'left');
  push(host.center,   'center');
  push(host.rightCol, 'right');
  return zones;
}

function bounceBackChip(chip: HTMLElement): void {
  if (shouldReduceMotion()) return;
  chip.classList.remove('ne-bounce');
  // Force reflow so the animation can restart if the user drags the same chip twice.
  void chip.offsetWidth;
  chip.classList.add('ne-bounce');
  window.setTimeout(() => chip.classList.remove('ne-bounce'), 320);
}

function spawnPoof(root: HTMLElement, clientX: number, clientY: number): void {
  if (shouldReduceMotion()) return;
  const rect = root.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ne-poof';
  ripple.style.left = `${clientX - rect.left}px`;
  ripple.style.top  = `${clientY - rect.top}px`;
  root.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 320);
}
