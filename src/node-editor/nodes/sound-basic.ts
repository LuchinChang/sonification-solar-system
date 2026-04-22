// src/node-editor/nodes/sound-basic.ts
//
// Unit 8 — Sound-side basic NodeDefinitions.
//
// Deferred-commit: codegen() only runs when the editor panel closes. If an
// input port has an inbound edge, we emit a live Strudel
// `signal(() => globalThis.__sw_<sweeperId>_<outPortId>)` reference. Data-side
// nodes (Unit 6) write those globals each rAF frame — see MEMORY.md and the
// sweeper architecture notes in src/shapes.ts. If unwired, the node's static
// default param is inlined so the patch stays valid.

import { registerNodeDef } from '../registry';
import { signalRefRaw } from '../codegen';
import type { Edge, NodeDefinition } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** First wire wins; multi-wire semantics are a Unit 14 concern. */
function signalRefFromEdge(sweeperId: number, inbound: Edge[]): string | null {
  if (inbound.length === 0) return null;
  const edge = inbound[0]!;
  return `signal(() => globalThis.__sw_${sweeperId}_${edge.from.portId})`;
}

/** Raw global ref — no signal() wrapper. For nodes that re-wrap the value. */
function rawRefFromEdge(sweeperId: number, inbound: Edge[]): string | null {
  if (inbound.length === 0) return null;
  const edge = inbound[0]!;
  return signalRefRaw(sweeperId, edge.from.portId);
}

function paramString(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

function paramNumber(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

// Available root note options in the pitch UI. Keep these in sync with the
// quantize helper's accepted input format (`<name><octave>`, lowercase).
const PITCH_ROOT_OPTIONS: ReadonlyArray<string> = ['c3', 'c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4', 'c5'];

/** Span presets for chromatic quantization. */
const PITCH_SPAN_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value:  7, label: '7 (diatonic)' },
  { value: 12, label: '12 (chromatic)' },
  { value: 24, label: '24 (2 octaves)' },
];

/** Build a <select> populated with the given options. */
function buildSelect(
  options: ReadonlyArray<{ value: string; label: string }>,
  initial: string,
): HTMLSelectElement {
  const el = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value       = opt.value;
    o.textContent = opt.label;
    el.appendChild(o);
  }
  el.value = initial;
  return el;
}

// ── 1. sound.pitch ───────────────────────────────────────────────────────────

export const soundPitchDef: NodeDefinition = {
  type:  'sound.pitch',
  side:  'sound',
  label: 'Pitch',
  inputs: [{ id: 'note', label: 'note', kind: 'pattern' }],
  // `note`  → literal Strudel pattern used when the port is unwired.
  // `root`  → root note of the chromatic scale used when a signal IS wired.
  // `span`  → number of semitones that map across the 0–1 input range.
  defaultParams: { note: 'c4', root: 'c4', span: 12 },

  codegen(ctx, params, inbound) {
    const raw = rawRefFromEdge(ctx.sweeperId, inbound);
    if (raw !== null) {
      const root = paramString(params, 'root', 'c4');
      const span = paramNumber(params, 'span', 12);
      return `.note(signal(() => globalThis.__sw_quantizeNote(${raw}, "${root}", ${span})))`;
    }
    return `.note(\`${paramString(params, 'note', 'c4')}\`)`;
  },

  ui(node, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'node-param';

    // note pattern (fallback when no signal is wired)
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

    // root note (used by quantization when a signal is wired in)
    const rootRow = document.createElement('label');
    rootRow.textContent = 'root: ';
    const rootSelect = buildSelect(
      PITCH_ROOT_OPTIONS.map(v => ({ value: v, label: v })),
      paramString(node.params, 'root', 'c4'),
    );
    rootSelect.addEventListener('change', () => {
      onChange({ params: { ...node.params, root: rootSelect.value } });
    });
    rootRow.appendChild(rootSelect);
    wrap.appendChild(rootRow);

    // span (number of semitones mapped across the 0–1 signal range)
    const spanRow = document.createElement('label');
    spanRow.textContent = 'span: ';
    const spanSelect = buildSelect(
      PITCH_SPAN_OPTIONS.map(o => ({ value: String(o.value), label: o.label })),
      String(paramNumber(node.params, 'span', 12)),
    );
    spanSelect.addEventListener('change', () => {
      const next = Number.parseInt(spanSelect.value, 10);
      onChange({ params: { ...node.params, span: Number.isFinite(next) ? next : 12 } });
    });
    spanRow.appendChild(spanSelect);
    wrap.appendChild(spanRow);

    return wrap;
  },
};

// ── 2. sound.frequency-range ─────────────────────────────────────────────────
//
// Writes shape.freqLow/freqHigh directly in Unit 14's codegen driver; emits
// no chain fragment of its own. Distance→freq mapping still lives in
// shapes.ts's _toSweeperCode.

export const soundFrequencyRangeDef: NodeDefinition = {
  type:  'sound.frequency-range',
  side:  'sound',
  label: 'Frequency Range',
  inputs: [
    { id: 'min', label: 'min', kind: 'number' },
    { id: 'max', label: 'max', kind: 'number' },
  ],
  defaultParams: { min: 100, max: 1000 },

  codegen() {
    return '';
  },
};

// ── 3. sound.lpf ─────────────────────────────────────────────────────────────

export const soundLpfDef: NodeDefinition = {
  type:  'sound.lpf',
  side:  'sound',
  label: 'Low-pass Filter',
  inputs: [{ id: 'frequency', label: 'frequency', kind: 'number' }],
  defaultParams: { frequency: 1200 },

  codegen(ctx, params, inbound) {
    const sig = signalRefFromEdge(ctx.sweeperId, inbound);
    if (sig !== null) return `.lpf(${sig})`;
    return `.lpf(${paramNumber(params, 'frequency', 1200)})`;
  },
};

// ── 4. sound.gain ────────────────────────────────────────────────────────────

export const soundGainDef: NodeDefinition = {
  type:  'sound.gain',
  side:  'sound',
  label: 'Gain',
  inputs: [{ id: 'amp', label: 'amp', kind: 'number' }],
  defaultParams: { amp: 0.6 },

  codegen(ctx, params, inbound) {
    const sig = signalRefFromEdge(ctx.sweeperId, inbound);
    if (sig !== null) return `.gain(${sig})`;
    return `.gain(${paramNumber(params, 'amp', 0.6)})`;
  },
};

// ── Registration (module-load side effect) ───────────────────────────────────

export function registerSoundBasicNodes(): void {
  registerNodeDef(soundPitchDef);
  registerNodeDef(soundFrequencyRangeDef);
  registerNodeDef(soundLpfDef);
  registerNodeDef(soundGainDef);
}

registerSoundBasicNodes();
