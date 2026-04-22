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
import type { Edge, NodeDefinition } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** First wire wins; multi-wire semantics are a Unit 14 concern. */
function signalRefFromEdge(sweeperId: number, inbound: Edge[]): string | null {
  if (inbound.length === 0) return null;
  const edge = inbound[0]!;
  return `signal(() => globalThis.__sw_${sweeperId}_${edge.from.portId})`;
}

function paramString(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

function paramNumber(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' ? v : fallback;
}

// ── 1. sound.pitch ───────────────────────────────────────────────────────────

export const soundPitchDef: NodeDefinition = {
  type:  'sound.pitch',
  side:  'sound',
  label: 'Pitch',
  inputs: [{ id: 'note', label: 'note', kind: 'pattern' }],
  defaultParams: { note: 'c4' },

  codegen(ctx, params, inbound) {
    const sig = signalRefFromEdge(ctx.sweeperId, inbound);
    if (sig !== null) return `.note(${sig})`;
    return `.note(\`${paramString(params, 'note', 'c4')}\`)`;
  },

  ui(node, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'node-param';
    wrap.textContent = 'note: ';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = paramString(node.params, 'note', 'c4');
    input.addEventListener('input', () => {
      onChange({ params: { ...node.params, note: input.value } });
    });
    wrap.appendChild(input);
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
