// src/node-editor/nodes/sound-effects.ts
//
// Unit 9 — Sound-side effect nodes: distortion + reverb.
//
// Strudel method choices (see node_modules/@strudel/core/controls.mjs):
//   • `.shape(x)`  — waveshaper amount, single-scalar; chosen over `.distort`
//                    which takes a compound "vol:type" value.
//   • `.room(r)`   — reverb wet amount.
//   • `.size(s)`   — alias of `.roomsize`.
//
// Codegen emits either a literal param value or a live `signal(() => ...)`
// reference to `globalThis.__sw_<sweeperId>_<outName>` when an edge is wired
// into an input port — matching the zero-glitch update pattern the sweeper
// already uses for freq/gain.

import { registerNodeDef } from '../registry';
import type { CodegenCtx, Edge, NodeDefinition } from '../types';

interface DistortionParams { amount: number }
interface ReverbParams     { room: number; size: number }

/**
 * Resolve an input-port expression to a Strudel-evaluable string:
 * inbound edge → live signal, otherwise the literal fallback.
 */
function resolveParamExpr(
  ctx: CodegenCtx,
  inbound: Edge[],
  portId: string,
  literal: number,
): string {
  const edge = inbound.find(e => e.to.portId === portId);
  if (!edge) return literal.toString();
  return `signal(() => globalThis.__sw_${ctx.sweeperId}_${edge.from.portId})`;
}

function numParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

const distortionDef: NodeDefinition = {
  type:  'sound.distortion',
  side:  'sound',
  label: 'Distortion',
  inputs: [
    {
      id: 'amount', label: 'amount', kind: 'number', continuous: true,
      min: 0, max: 1, unit: '0..1',
      description: 'Waveshaper drive. 0 is clean; higher values add harmonic saturation and, beyond ~0.6, aggressive clipping.',
    },
  ],
  defaultParams: { amount: 0.2 } satisfies DistortionParams,
  codegen: (ctx, params, inbound) => {
    const amount = numParam(params, 'amount', 0.2);
    return `.shape(${resolveParamExpr(ctx, inbound, 'amount', amount)})`;
  },
};

const reverbDef: NodeDefinition = {
  type:  'sound.reverb',
  side:  'sound',
  label: 'Reverb',
  inputs: [
    {
      id: 'room', label: 'room', kind: 'number', continuous: true,
      min: 0, max: 1, unit: '0..1',
      description: 'Reverb wet amount. 0 is dry; 1 is fully wet.',
    },
    {
      id: 'size', label: 'size', kind: 'number', continuous: true,
      min: 0, max: 1, unit: '0..1',
      description: 'Simulated room size. Larger values give longer, more diffuse tails.',
    },
  ],
  defaultParams: { room: 0.4, size: 0.5 } satisfies ReverbParams,
  codegen: (ctx, params, inbound) => {
    const room = numParam(params, 'room', 0.4);
    const size = numParam(params, 'size', 0.5);
    const roomExpr = resolveParamExpr(ctx, inbound, 'room', room);
    const sizeExpr = resolveParamExpr(ctx, inbound, 'size', size);
    return `.room(${roomExpr}).size(${sizeExpr})`;
  },
};

registerNodeDef(distortionDef);
registerNodeDef(reverbDef);

export { distortionDef, reverbDef };
