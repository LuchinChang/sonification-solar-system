// src/node-editor/nodes/sweeper.ts
//
// Unit 7: Sweeper-self property nodes.
//
// Four nodes that mutate the active sweeper's own state (not Strudel source
// fragments):
//   • sweeper.cluster-count  — writes CanvasShape.k
//   • sweeper.fineness       — writes CanvasShape.fineness
//   • sweeper.generator      — writes CanvasShape.instrument  (waveform)
//   • sweeper.length         — writes CanvasShape.size        (arm length)
//
// Each node's codegen() returns '' — these don't inject Strudel chain fragments.
// Their ui() mutates the sweeper directly; the editor's deferred-commit on
// closeEditor() re-evaluates the sweeper's Strudel code via the existing path.

import { clamp } from '../../engine';
import { MAX_SHAPE_SIZE, MIN_SHAPE_SIZE } from '../../state';
import type { CanvasShape } from '../../shapes';
import { registerNodeDef } from '../registry';
import type { Node } from '../types';
import { currentSweeperId } from '../panel';

// ── Sweeper resolver ─────────────────────────────────────────────────────────
//
// The ui() contract only gives us a Node + an onChange(patch) callback, not
// the CanvasShape instance the node edits. main.ts owns that mapping, so we
// accept a resolver via setSweeperResolver() at boot. Without a resolver the
// ui() handlers degrade to updating the node's params only.
//
// TODO(Unit 14): once panel.ts wires a live NodeGraph into each sweeper and
// hands the Node's associated sweeper to ui(), this resolver can go away.

type SweeperResolver = (id: number) => CanvasShape | null;
let resolveSweeper: SweeperResolver | null = null;

export function setSweeperResolver(resolver: SweeperResolver | null): void {
  resolveSweeper = resolver;
}

function activeSweeper(): CanvasShape | null {
  const id = currentSweeperId();
  if (id === null || resolveSweeper === null) return null;
  const s = resolveSweeper(id);
  return s && s.type === 'sweeper' ? s : null;
}

// Length changes mutate sweeper.size directly, but clusters/ticks derived from
// it are stale until rebuildSweepTicks runs. main.ts owns linkLines/
// orbitalMaxRadius + redraw + telemetry, so it registers a geometry-refresh
// hook here following the same resolver pattern as setSweeperResolver above.
type SweeperGeometryRefresh = (sweeper: CanvasShape) => void;
let refreshSweeperGeometry: SweeperGeometryRefresh | null = null;

export function setSweeperGeometryRefresh(fn: SweeperGeometryRefresh | null): void {
  refreshSweeperGeometry = fn;
}

// ── Shared UI chrome (Martian Dusk tokens) ───────────────────────────────────

const UI_FONT_MONO = 'var(--font-mono)';

function containerEl(): HTMLDivElement {
  const box = document.createElement('div');
  box.style.display        = 'flex';
  box.style.flexDirection  = 'column';
  box.style.gap            = '4px';
  box.style.minWidth       = '180px';
  return box;
}

/** Build a slider + numeric readout row. Returns the row element and a
 *  `bindInput` helper that wires the slider's input event to the caller. */
function buildSliderRow(opts: {
  min: number;
  max: number;
  value: number;
  formatReadout?: (v: number) => string;
}): { row: HTMLDivElement; slider: HTMLInputElement; readout: HTMLSpanElement } {
  const format = opts.formatReadout ?? ((v: number): string => String(v));

  const row = document.createElement('div');
  row.style.display    = 'flex';
  row.style.alignItems = 'center';
  row.style.gap        = '8px';
  row.style.padding    = '6px 4px';

  const slider = document.createElement('input');
  slider.type       = 'range';
  slider.min        = String(opts.min);
  slider.max        = String(opts.max);
  slider.step       = '1';
  slider.value      = String(opts.value);
  slider.style.flex = '1';

  const readout = document.createElement('span');
  readout.textContent    = format(opts.value);
  readout.style.fontFamily = UI_FONT_MONO;
  readout.style.fontSize   = '11px';
  readout.style.color      = 'var(--text-primary)';
  readout.style.marginLeft = 'auto';

  row.append(slider, readout);
  return { row, slider, readout };
}

// ── Typed param views ────────────────────────────────────────────────────────

const WAVEFORMS = ['sine', 'sawtooth', 'square', 'triangle'] as const;
type Waveform = typeof WAVEFORMS[number];

// ── Node registrations ───────────────────────────────────────────────────────

registerNodeDef({
  type:  'sweeper.cluster-count',
  side:  'sweeper',
  label: 'Cluster Count',
  inputs: [{ id: 'k', label: 'k', kind: 'number' }],
  outputs: [],
  defaultParams: { k: 3 },
  codegen: () => '',
  ui(node: Node, onChange: (patch: Partial<Node>) => void): HTMLElement {
    const k = Number(node.params.k ?? 3);
    const root = containerEl();
    const { row, slider, readout } = buildSliderRow({ min: 1, max: 12, value: k });

    slider.addEventListener('input', () => {
      const next = clamp(parseInt(slider.value, 10) || 1, 1, 12);
      readout.textContent = String(next);
      const sweeper = activeSweeper();
      if (sweeper) sweeper.k = next;
      onChange({ params: { ...node.params, k: next } });
    });

    root.append(row);
    return root;
  },
});

registerNodeDef({
  type:  'sweeper.fineness',
  side:  'sweeper',
  label: 'Fineness',
  inputs: [{ id: 'steps', label: 'steps', kind: 'number' }],
  outputs: [],
  defaultParams: { steps: 120 },
  codegen: () => '',
  ui(node: Node, onChange: (patch: Partial<Node>) => void): HTMLElement {
    const steps = Number(node.params.steps ?? 120);
    const root = containerEl();
    const { row, slider, readout } = buildSliderRow({ min: 12, max: 360, value: steps });

    slider.addEventListener('input', () => {
      const next = clamp(parseInt(slider.value, 10) || 12, 12, 360);
      readout.textContent = String(next);
      const sweeper = activeSweeper();
      if (sweeper) sweeper.fineness = next;
      onChange({ params: { ...node.params, steps: next } });
    });

    root.append(row);
    return root;
  },
});

registerNodeDef({
  type:  'sweeper.generator',
  side:  'sweeper',
  label: 'Generator',
  inputs: [{ id: 'waveform', label: 'waveform', kind: 'any' }],
  outputs: [],
  defaultParams: { waveform: 'sine' satisfies Waveform as Waveform },
  codegen: () => '',
  ui(node: Node, onChange: (patch: Partial<Node>) => void): HTMLElement {
    const current = String(node.params.waveform ?? 'sine');
    const root = containerEl();

    const row = document.createElement('div');
    row.style.display    = 'flex';
    row.style.alignItems = 'center';
    row.style.padding    = '6px 4px';

    const select = document.createElement('select');
    select.style.flex       = '1';
    select.style.fontFamily = UI_FONT_MONO;
    select.style.fontSize   = '11px';
    for (const w of WAVEFORMS) {
      const opt = document.createElement('option');
      opt.value       = w;
      opt.textContent = w;
      if (w === current) opt.selected = true;
      select.append(opt);
    }

    select.addEventListener('change', () => {
      const next: Waveform = (WAVEFORMS as readonly string[]).includes(select.value)
        ? select.value as Waveform
        : 'sine';
      const sweeper = activeSweeper();
      if (sweeper) sweeper.instrument = next;
      onChange({ params: { ...node.params, waveform: next } });
    });

    row.append(select);
    root.append(row);
    return root;
  },
});

registerNodeDef({
  type:  'sweeper.length',
  side:  'sweeper',
  label: 'Arm Length',
  inputs: [{ id: 'radius', label: 'radius', kind: 'number' }],
  outputs: [],
  defaultParams: { radius: MAX_SHAPE_SIZE },
  codegen: () => '',
  ui(node: Node, onChange: (patch: Partial<Node>) => void): HTMLElement {
    const radius = Number(node.params.radius ?? MAX_SHAPE_SIZE);
    const root = containerEl();
    const { row, slider, readout } = buildSliderRow({
      min: MIN_SHAPE_SIZE,
      max: MAX_SHAPE_SIZE,
      value: radius,
      formatReadout: v => `${v}px`,
    });

    slider.addEventListener('input', () => {
      const next = clamp(parseInt(slider.value, 10) || MIN_SHAPE_SIZE, MIN_SHAPE_SIZE, MAX_SHAPE_SIZE);
      readout.textContent = `${next}px`;
      const sweeper = activeSweeper();
      if (sweeper) {
        sweeper.size = next;
        refreshSweeperGeometry?.(sweeper);
      }
      onChange({ params: { ...node.params, radius: next } });
    });

    root.append(row);
    return root;
  },
});
