// src/node-editor/nodes/sound-basic.ts
//
// Sound-side nodes — pitch, frequency, LPF, gain.
//
// Pre-baked codegen: each node reads its inbound 0..1 `SweepStack` via
// `ctx.resolveInboundStack`, applies its own curve + range transform, and
// emits a static Strudel pattern (e.g. `.freq("100 141 200 …")`). When
// unwired, the chip emits a scalar using its slider params.
//
// Each chip ships a `ui()` that renders two `buildSliderRow` controls for
// min/max, reusing the sidebar slider chrome so the look matches
// Cluster-Count / Fineness / Arm-Length exactly.

import { bakePattern, mapValue } from '../codegen';
import { quantizeNote } from '../codegen-helpers';
import { registerNodeDef } from '../registry';
import type { NodeDefinition, Node } from '../types';

// ── Param helpers ────────────────────────────────────────────────────────────

function paramNumber(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function paramString(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

// ── Slider chrome (matches sidebar.ts / nodes/sweeper.ts styling) ───────────

const UI_FONT_MONO = 'var(--font-mono)';

function containerEl(): HTMLDivElement {
  const box = document.createElement('div');
  box.style.display       = 'flex';
  box.style.flexDirection = 'column';
  box.style.gap           = '4px';
  box.style.minWidth      = '180px';
  return box;
}

function buildSliderRow(opts: {
  label:   string;
  min:     number;
  max:     number;
  step:    number;
  value:   number;
  format?: (v: number) => string;
}): { row: HTMLDivElement; slider: HTMLInputElement; readout: HTMLSpanElement } {
  const format = opts.format ?? ((v: number): string => v.toFixed(2));

  const row = document.createElement('div');
  row.style.display    = 'flex';
  row.style.alignItems = 'center';
  row.style.gap        = '6px';
  row.style.padding    = '3px 4px';

  const label = document.createElement('span');
  label.textContent     = opts.label;
  label.style.fontFamily = UI_FONT_MONO;
  label.style.fontSize   = '10px';
  label.style.color      = 'var(--text-muted, var(--text-primary))';
  label.style.minWidth   = '28px';

  const slider = document.createElement('input');
  slider.type       = 'range';
  slider.min        = String(opts.min);
  slider.max        = String(opts.max);
  slider.step       = String(opts.step);
  slider.value      = String(opts.value);
  slider.style.flex = '1';

  const readout = document.createElement('span');
  readout.textContent    = format(opts.value);
  readout.style.fontFamily = UI_FONT_MONO;
  readout.style.fontSize   = '11px';
  readout.style.color      = 'var(--text-primary)';
  readout.style.marginLeft = 'auto';

  row.append(label, slider, readout);
  return { row, slider, readout };
}

/**
 * Build a "min/max" pair of sliders for a sound chip's range. Wires both
 * sliders' input events to update `node.params.min`/`node.params.max`
 * through `onChange`.
 */
function buildRangeUi(
  node: Node,
  onChange: (patch: Partial<Node>) => void,
  cfg: {
    sliderMin: number;
    sliderMax: number;
    step:      number;
    unit:      string;
    format?:   (v: number) => string;
  },
): HTMLElement {
  const root = containerEl();
  const initMin = paramNumber(node.params, 'min', cfg.sliderMin);
  const initMax = paramNumber(node.params, 'max', cfg.sliderMax);

  const minCtl = buildSliderRow({
    label: `min`,
    min: cfg.sliderMin, max: cfg.sliderMax, step: cfg.step,
    value: initMin,
    format: cfg.format,
  });
  const maxCtl = buildSliderRow({
    label: `max`,
    min: cfg.sliderMin, max: cfg.sliderMax, step: cfg.step,
    value: initMax,
    format: cfg.format,
  });

  const unitLabel = document.createElement('div');
  unitLabel.textContent   = cfg.unit;
  unitLabel.style.fontFamily = UI_FONT_MONO;
  unitLabel.style.fontSize   = '10px';
  unitLabel.style.color      = 'var(--text-muted, var(--text-primary))';
  unitLabel.style.textAlign  = 'right';
  unitLabel.style.opacity    = '0.6';

  minCtl.slider.addEventListener('input', () => {
    const next = parseFloat(minCtl.slider.value);
    if (!Number.isFinite(next)) return;
    minCtl.readout.textContent = (cfg.format ?? (v => v.toFixed(2)))(next);
    onChange({ params: { ...node.params, min: next } });
  });
  maxCtl.slider.addEventListener('input', () => {
    const next = parseFloat(maxCtl.slider.value);
    if (!Number.isFinite(next)) return;
    maxCtl.readout.textContent = (cfg.format ?? (v => v.toFixed(2)))(next);
    onChange({ params: { ...node.params, max: next } });
  });

  root.append(minCtl.row, maxCtl.row, unitLabel);
  return root;
}

// ── 1. sound.pitch ───────────────────────────────────────────────────────────
//
// Pitch is an outlier in the pre-baked model: it maps 0..1 onto a quantized
// chromatic scale of note names ("c4", "e4", …). We bake the note strings
// per tick rather than numeric frequencies.

const PITCH_ROOT_OPTIONS = ['c3', 'c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4', 'c5'] as const;
const PITCH_SPAN_OPTIONS = [
  { value:  7, label: '7 (diatonic)' },
  { value: 12, label: '12 (chromatic)' },
  { value: 24, label: '24 (2 octaves)' },
] as const;

export const soundPitchDef: NodeDefinition = {
  type:  'sound.pitch',
  side:  'sound',
  label: 'Pitch',
  inputs: [{
    id: 'note', label: 'note', kind: 'number',
    description: 'Quantized chromatic pitch. Wired 0..1 signal maps across `span` semitones above `root`.',
  }],
  defaultParams: { note: 'c4', root: 'c4', span: 12 },

  codegen(ctx, params, inbound) {
    const noteEdge = inbound.find(e => e.to.portId === 'note');
    if (!noteEdge) {
      return `.note(\`${paramString(params, 'note', 'c4')}\`)`;
    }
    const stack = ctx.resolveInboundStack(noteEdge.to.nodeId, 'note');
    if (!stack) {
      return `.note(\`${paramString(params, 'note', 'c4')}\`)`;
    }
    const root  = paramString(params, 'root', 'c4');
    const span  = paramNumber(params, 'span', 12);
    const notes = stack.map(v => quantizeNote(v, root, span));
    const rows: string[] = [];
    for (let i = 0; i < notes.length; i += 8) {
      rows.push(notes.slice(i, i + 8).join(' '));
    }
    // Backticks (template literals) let the baked multi-line pattern survive
    // Strudel's JS transpiler pass — raw "\n" inside `"..."` is a
    // SyntaxError (unterminated string constant). Whitespace inside backticks
    // is just pattern-separator for Strudel's mini-notation.
    return `.note(\`${rows.join('\n    ')}\`)`;
  },

  ui(node, onChange) {
    // Pitch's UI stays intact (root/span selects) — it's a quantizer, not a
    // linear min/max mapping. Kept untouched so existing tests still pass.
    const wrap = document.createElement('div');
    wrap.className = 'node-param';

    const noteRow = document.createElement('label');
    noteRow.textContent = 'note: ';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.value = paramString(node.params, 'note', 'c4');
    noteInput.addEventListener('input', () => {
      onChange({ params: { ...node.params, note: noteInput.value } });
    });
    noteRow.appendChild(noteInput);
    wrap.appendChild(noteRow);

    const rootRow = document.createElement('label');
    rootRow.textContent = 'root: ';
    const rootSelect = document.createElement('select');
    for (const v of PITCH_ROOT_OPTIONS) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      rootSelect.appendChild(o);
    }
    rootSelect.value = paramString(node.params, 'root', 'c4');
    rootSelect.addEventListener('change', () => {
      onChange({ params: { ...node.params, root: rootSelect.value } });
    });
    rootRow.appendChild(rootSelect);
    wrap.appendChild(rootRow);

    const spanRow = document.createElement('label');
    spanRow.textContent = 'span: ';
    const spanSelect = document.createElement('select');
    for (const o of PITCH_SPAN_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = String(o.value); opt.textContent = o.label;
      spanSelect.appendChild(opt);
    }
    spanSelect.value = String(paramNumber(node.params, 'span', 12));
    spanSelect.addEventListener('change', () => {
      const next = Number.parseInt(spanSelect.value, 10);
      onChange({ params: { ...node.params, span: Number.isFinite(next) ? next : 12 } });
    });
    spanRow.appendChild(spanSelect);
    wrap.appendChild(spanRow);

    return wrap;
  },
};

// ── 2. sound.frequency ───────────────────────────────────────────────────────
//
// Replaces the old `sound.frequency-range` (two min/max input ports). Now
// exposes a single `frequency` input port that accepts a 0..1 stack, which
// is mapped through an exponential curve to `[min, max]` Hz.

export const soundFrequencyDef: NodeDefinition = {
  type:  'sound.frequency',
  side:  'sound',
  label: 'Frequency',
  inputs: [{
    id: 'frequency', label: 'frequency', kind: 'number',
    min: 0, max: 1, unit: '0..1',
    description: 'Normalized 0..1 control signal mapped exponentially onto [min, max] Hz.',
  }],
  defaultParams: { min: 20, max: 4400 },

  codegen(_ctx, params, inbound) {
    const min = paramNumber(params, 'min', 20);
    const max = paramNumber(params, 'max', 4400);
    const edge = inbound.find(e => e.to.portId === 'frequency');
    if (!edge) {
      // Unwired: emit a scalar at the midpoint (exp interpolated at v = 0.5).
      return `.freq(${mapValue(0.5, min, max, 'exp').toFixed(2)})`;
    }
    const stack = _ctx.resolveInboundStack(getCodegenNodeId(inbound), 'frequency');
    if (!stack) return `.freq(${mapValue(0.5, min, max, 'exp').toFixed(2)})`;
    return `.freq(\`${bakePattern(stack, min, max, 'exp')}\`)`;
  },

  ui(node, onChange) {
    return buildRangeUi(node, onChange, {
      sliderMin: 20, sliderMax: 4400, step: 1,
      unit:   'Hz (exp curve)',
      format: v => `${v.toFixed(0)} Hz`,
    });
  },
};

// ── 3. sound.lpf ─────────────────────────────────────────────────────────────

export const soundLpfDef: NodeDefinition = {
  type:  'sound.lpf',
  side:  'sound',
  label: 'Low-pass Filter',
  inputs: [{
    id: 'frequency', label: 'frequency', kind: 'number',
    min: 0, max: 1, unit: '0..1',
    description: 'Cutoff frequency, mapped exponentially onto [min, max] Hz.',
  }],
  defaultParams: { min: 40, max: 200 },

  codegen(_ctx, params, inbound) {
    const min = paramNumber(params, 'min', 40);
    const max = paramNumber(params, 'max', 200);
    const edge = inbound.find(e => e.to.portId === 'frequency');
    if (!edge) return `.lpf(${mapValue(0.5, min, max, 'exp').toFixed(2)})`;
    const stack = _ctx.resolveInboundStack(getCodegenNodeId(inbound), 'frequency');
    if (!stack) return `.lpf(${mapValue(0.5, min, max, 'exp').toFixed(2)})`;
    return `.lpf(\`${bakePattern(stack, min, max, 'exp')}\`)`;
  },

  ui(node, onChange) {
    return buildRangeUi(node, onChange, {
      sliderMin: 20, sliderMax: 20000, step: 1,
      unit:   'Hz (exp curve)',
      format: v => `${v.toFixed(0)} Hz`,
    });
  },
};

// ── 4. sound.gain ────────────────────────────────────────────────────────────

export const soundGainDef: NodeDefinition = {
  type:  'sound.gain',
  side:  'sound',
  label: 'Gain',
  inputs: [{
    id: 'amp', label: 'amp', kind: 'number',
    min: 0, max: 1, unit: '0..1',
    description: 'Output amplitude, mapped with a perceptual (quadratic) curve onto [min, max].',
  }],
  defaultParams: { min: 0.0, max: 1.0 },

  codegen(_ctx, params, inbound) {
    const min = paramNumber(params, 'min', 0.0);
    const max = paramNumber(params, 'max', 1.0);
    const edge = inbound.find(e => e.to.portId === 'amp');
    if (!edge) return `.gain(${mapValue(0.5, min, max, 'quadratic').toFixed(3)})`;
    const stack = _ctx.resolveInboundStack(getCodegenNodeId(inbound), 'amp');
    if (!stack) return `.gain(${mapValue(0.5, min, max, 'quadratic').toFixed(3)})`;
    return `.gain(\`${bakePattern(stack, min, max, 'quadratic', 3)}\`)`;
  },

  ui(node, onChange) {
    return buildRangeUi(node, onChange, {
      sliderMin: 0, sliderMax: 1, step: 0.01,
      unit:   '0..1 (perceptual)',
      format: v => v.toFixed(2),
    });
  },
};

// ── Helper: pull the node id back from an inbound edge list ─────────────────
//
// The `codegen` signature receives `inbound: Edge[]` but not the node's id.
// The destination node id is the same across all edges in `inbound`, so we
// read it from `edges[0].to.nodeId`. `resolveInboundStack` needs that id.

function getCodegenNodeId(inbound: import('../types').Edge[]): string {
  return inbound[0]?.to.nodeId ?? '';
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerSoundBasicNodes(): void {
  registerNodeDef(soundPitchDef);
  registerNodeDef(soundFrequencyDef);
  registerNodeDef(soundLpfDef);
  registerNodeDef(soundGainDef);
}

registerSoundBasicNodes();
