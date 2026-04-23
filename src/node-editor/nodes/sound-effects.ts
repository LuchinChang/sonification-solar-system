// src/node-editor/nodes/sound-effects.ts
//
// Sound-side effect nodes: distortion + reverb. Pre-baked codegen — same
// model as sound-basic.ts: resolve the inbound 0..1 stack, apply a linear
// curve across [min, max], emit a static Strudel pattern fragment.
//
// Strudel method choices:
//   • `.shape(x)`  — waveshaper amount, single-scalar.
//   • `.room(r)`   — reverb wet amount.
//   • `.size(s)`   — alias of `.roomsize`.

import { bakePattern, mapValue } from '../codegen';
import { registerNodeDef } from '../registry';
import type { NodeDefinition, Node, Edge } from '../types';

function paramNumber(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bakeOrScalar(
  ctx: Parameters<NodeDefinition['codegen']>[0],
  inbound: Edge[],
  portId: string,
  min: number,
  max: number,
  method: 'shape' | 'room' | 'size',
  precision = 3,
): string {
  const edge = inbound.find(e => e.to.portId === portId);
  if (!edge) return `.${method}(${mapValue(0.5, min, max, 'linear').toFixed(precision)})`;
  const stack = ctx.resolveInboundStack(edge.to.nodeId, portId);
  if (!stack) return `.${method}(${mapValue(0.5, min, max, 'linear').toFixed(precision)})`;
  // Backticks: `bakePattern` wraps lines with "\n    " for readability.
  // Inside `"..."` that's a JS SyntaxError ("unterminated string constant");
  // template literals accept raw newlines, and Strudel's mini-notation
  // treats whitespace as the event separator either way.
  return `.${method}(\`${bakePattern(stack, min, max, 'linear', precision)}\`)`;
}

// ── Shared min/max slider UI (mirrors sound-basic.ts buildRangeUi) ──────────

const UI_FONT_MONO = 'var(--font-mono)';

function buildMinMaxSliders(
  node: Node,
  onChange: (patch: Partial<Node>) => void,
  cfg: { sliderMin: number; sliderMax: number; step: number; label: string },
): HTMLElement {
  const root = document.createElement('div');
  root.style.display       = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap           = '4px';
  root.style.minWidth      = '180px';

  const heading = document.createElement('div');
  heading.textContent       = cfg.label;
  heading.style.fontFamily  = UI_FONT_MONO;
  heading.style.fontSize    = '10px';
  heading.style.opacity     = '0.7';
  root.appendChild(heading);

  const make = (key: 'min' | 'max', initial: number): HTMLDivElement => {
    const row = document.createElement('div');
    row.style.display    = 'flex';
    row.style.alignItems = 'center';
    row.style.gap        = '6px';
    row.style.padding    = '3px 4px';

    const label = document.createElement('span');
    label.textContent = key;
    label.style.fontFamily = UI_FONT_MONO;
    label.style.fontSize   = '10px';
    label.style.minWidth   = '28px';

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = String(cfg.sliderMin);
    slider.max   = String(cfg.sliderMax);
    slider.step  = String(cfg.step);
    slider.value = String(initial);
    slider.style.flex = '1';

    const readout = document.createElement('span');
    readout.textContent = initial.toFixed(2);
    readout.style.fontFamily = UI_FONT_MONO;
    readout.style.fontSize   = '11px';
    readout.style.marginLeft = 'auto';

    slider.addEventListener('input', () => {
      const next = parseFloat(slider.value);
      if (!Number.isFinite(next)) return;
      readout.textContent = next.toFixed(2);
      onChange({ params: { ...node.params, [key]: next } });
    });

    row.append(label, slider, readout);
    return row;
  };

  root.appendChild(make('min', paramNumber(node.params, 'min', cfg.sliderMin)));
  root.appendChild(make('max', paramNumber(node.params, 'max', cfg.sliderMax)));
  return root;
}

// ── sound.distortion ─────────────────────────────────────────────────────────

const distortionDef: NodeDefinition = {
  type:  'sound.distortion',
  side:  'sound',
  label: 'Distortion',
  inputs: [{
    id: 'amount', label: 'amount', kind: 'number', continuous: true,
    min: 0, max: 1, unit: '0..1',
    description: 'Waveshaper drive. Normalized 0..1 input mapped linearly onto [min, max].',
  }],
  defaultParams: { min: 0.0, max: 1.0 },

  codegen: (ctx, params, inbound) => {
    const min = paramNumber(params, 'min', 0);
    const max = paramNumber(params, 'max', 1);
    return bakeOrScalar(ctx, inbound, 'amount', min, max, 'shape');
  },

  ui(node, onChange) {
    return buildMinMaxSliders(node, onChange, {
      sliderMin: 0, sliderMax: 1, step: 0.01,
      label: 'amount range',
    });
  },
};

// ── sound.reverb ─────────────────────────────────────────────────────────────
//
// Two inputs (room, size). Each has independent min/max params. A single
// chip emits both `.room(…)` and `.size(…)` fragments.

const reverbDef: NodeDefinition = {
  type:  'sound.reverb',
  side:  'sound',
  label: 'Reverb',
  inputs: [
    {
      id: 'room', label: 'room', kind: 'number', continuous: true,
      min: 0, max: 1, unit: '0..1',
      description: 'Reverb wet amount. 0..1 input mapped linearly onto [roomMin, roomMax].',
    },
    {
      id: 'size', label: 'size', kind: 'number', continuous: true,
      min: 0, max: 1, unit: '0..1',
      description: 'Simulated room size. 0..1 input mapped linearly onto [sizeMin, sizeMax].',
    },
  ],
  defaultParams: {
    roomMin: 0, roomMax: 1,
    sizeMin: 0, sizeMax: 1,
  },

  codegen: (ctx, params, inbound) => {
    const roomMin = paramNumber(params, 'roomMin', 0);
    const roomMax = paramNumber(params, 'roomMax', 1);
    const sizeMin = paramNumber(params, 'sizeMin', 0);
    const sizeMax = paramNumber(params, 'sizeMax', 1);
    const roomFrag = bakeOrScalar(ctx, inbound, 'room', roomMin, roomMax, 'room');
    const sizeFrag = bakeOrScalar(ctx, inbound, 'size', sizeMin, sizeMax, 'size');
    return `${roomFrag}${sizeFrag}`;
  },

  ui(node, onChange) {
    const wrap = document.createElement('div');
    wrap.style.display       = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap           = '8px';

    // room min/max
    const roomWrap = document.createElement('div');
    roomWrap.style.display       = 'flex';
    roomWrap.style.flexDirection = 'column';
    const roomLabel = document.createElement('div');
    roomLabel.textContent = 'room range';
    roomLabel.style.fontFamily = UI_FONT_MONO;
    roomLabel.style.fontSize   = '10px';
    roomLabel.style.opacity    = '0.7';
    roomWrap.appendChild(roomLabel);
    roomWrap.appendChild(buildPairFor('roomMin', 'roomMax', 'room', node, onChange));
    wrap.appendChild(roomWrap);

    // size min/max
    const sizeWrap = document.createElement('div');
    sizeWrap.style.display       = 'flex';
    sizeWrap.style.flexDirection = 'column';
    const sizeLabel = document.createElement('div');
    sizeLabel.textContent = 'size range';
    sizeLabel.style.fontFamily = UI_FONT_MONO;
    sizeLabel.style.fontSize   = '10px';
    sizeLabel.style.opacity    = '0.7';
    sizeWrap.appendChild(sizeLabel);
    sizeWrap.appendChild(buildPairFor('sizeMin', 'sizeMax', 'size', node, onChange));
    wrap.appendChild(sizeWrap);

    return wrap;
  },
};

function buildPairFor(
  minKey: string,
  maxKey: string,
  _role: string,
  node: Node,
  onChange: (patch: Partial<Node>) => void,
): HTMLElement {
  const make = (key: string, defaultVal: number): HTMLDivElement => {
    const row = document.createElement('div');
    row.style.display    = 'flex';
    row.style.alignItems = 'center';
    row.style.gap        = '6px';

    const lbl = document.createElement('span');
    lbl.textContent = key;
    lbl.style.fontFamily = UI_FONT_MONO;
    lbl.style.fontSize   = '10px';
    lbl.style.minWidth   = '52px';

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = '0'; slider.max = '1'; slider.step = '0.01';
    slider.value = String(paramNumber(node.params, key, defaultVal));
    slider.style.flex = '1';

    const readout = document.createElement('span');
    readout.textContent    = slider.value;
    readout.style.fontFamily = UI_FONT_MONO;
    readout.style.fontSize   = '11px';

    slider.addEventListener('input', () => {
      readout.textContent = slider.value;
      onChange({ params: { ...node.params, [key]: parseFloat(slider.value) } });
    });

    row.append(lbl, slider, readout);
    return row;
  };

  const wrap = document.createElement('div');
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.appendChild(make(minKey, 0));
  wrap.appendChild(make(maxKey, 1));
  return wrap;
}

registerNodeDef(distortionDef);
registerNodeDef(reverbDef);

export { distortionDef, reverbDef };
