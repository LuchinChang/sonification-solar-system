// src/__tests__/node-editor-sound-effects.test.ts
//
// Sound-effects nodes (distortion + reverb) in the pre-baked pipeline.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getNodeDef,
  listNodeDefs,
  registerNodeDef,
  _resetRegistryForTests,
} from '../node-editor/registry';
import {
  distortionDef,
  reverbDef,
} from '../node-editor/nodes/sound-effects';
import type { CodegenCtx, Edge, SweepStack } from '../node-editor/types';

// ── Shared fixtures ──────────────────────────────────────────────────────────

function makeCtx(
  sweeperId = 7,
  stacks: Record<string, SweepStack> = {},
): CodegenCtx {
  return {
    sweeperId,
    nodeVar: (nodeId: string) => `sw_${sweeperId}_${nodeId}`,
    incoming: () => [],
    paramsOf: <T = Record<string, unknown>>() => ({} as T),
    resolveInboundStack: (nodeId, portId) => stacks[`${nodeId}:${portId}`] ?? null,
  };
}

function makeEdge(portId: string): Edge {
  return {
    id:   'e-test',
    from: { nodeId: 'n-src', portId: 'v', dir: 'out' },
    to:   { nodeId: 'n-fx', portId,       dir: 'in' },
  };
}

beforeEach(() => {
  _resetRegistryForTests();
  registerNodeDef(distortionDef);
  registerNodeDef(reverbDef);
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('sound-effects registration', () => {
  it('registers sound.distortion on the sound side with amount input', () => {
    const def = getNodeDef('sound.distortion');
    expect(def).toBeDefined();
    expect(def?.side).toBe('sound');
    expect(def?.inputs).toHaveLength(1);
    expect(def?.inputs?.[0]).toMatchObject({
      id: 'amount', label: 'amount', kind: 'number', continuous: true,
    });
    expect(def?.defaultParams).toEqual({ min: 0, max: 1 });
  });

  it('registers sound.reverb on the sound side with room + size inputs', () => {
    const def = getNodeDef('sound.reverb');
    expect(def).toBeDefined();
    expect(def?.side).toBe('sound');
    expect(def?.inputs?.map(p => p.id)).toEqual(['room', 'size']);
    expect(def?.defaultParams).toEqual({
      roomMin: 0, roomMax: 1,
      sizeMin: 0, sizeMax: 1,
    });
  });

  it('both effect nodes appear in listNodeDefs("sound")', () => {
    const sound = listNodeDefs('sound');
    const types = sound.map(d => d.type);
    expect(types).toContain('sound.distortion');
    expect(types).toContain('sound.reverb');
  });
});

// ── Distortion codegen ───────────────────────────────────────────────────────

describe('sound.distortion codegen', () => {
  it('emits .shape(<scalar>) at the linear midpoint when unwired', () => {
    const out = distortionDef.codegen(makeCtx(), { min: 0, max: 1 }, []);
    // linear 0..1 midpoint = 0.5
    expect(out).toBe('.shape(0.500)');
  });

  it('respects user-edited min/max', () => {
    const out = distortionDef.codegen(makeCtx(), { min: 0.2, max: 0.8 }, []);
    // midpoint = 0.5 of [0.2, 0.8] = 0.5
    expect(out).toBe('.shape(0.500)');
  });

  it('bakes a pattern from the inbound stack', () => {
    const stack = [0, 0.5, 1];
    const ctx  = makeCtx(3, { 'n-fx:amount': stack });
    const edge = makeEdge('amount');
    const out  = distortionDef.codegen(ctx, { min: 0, max: 1 }, [edge]);
    expect(out).toContain('.shape(`');
    expect(out).toContain('0.000');
    expect(out).toContain('0.500');
    expect(out).toContain('1.000');
  });
});

// ── Reverb codegen ───────────────────────────────────────────────────────────

describe('sound.reverb codegen', () => {
  it('emits .room(mid).size(mid) when both unwired', () => {
    const out = reverbDef.codegen(
      makeCtx(),
      { roomMin: 0, roomMax: 1, sizeMin: 0, sizeMax: 1 },
      [],
    );
    expect(out).toBe('.room(0.500).size(0.500)');
  });

  it('mixes a baked room pattern with a scalar size when only room is wired', () => {
    const stack = [0, 1];
    const ctx   = makeCtx(12, { 'n-fx:room': stack });
    const edge  = makeEdge('room');
    const out   = reverbDef.codegen(ctx, {
      roomMin: 0, roomMax: 1, sizeMin: 0, sizeMax: 1,
    }, [edge]);
    expect(out).toContain('.room(`');
    expect(out).toContain('.size(0.500)');
  });

  it('bakes both .room and .size patterns when both are wired', () => {
    const roomStack = [0, 0.5];
    const sizeStack = [0.5, 1];
    const ctx   = makeCtx(4, {
      'n-fx:room': roomStack,
      'n-fx:size': sizeStack,
    });
    const edges: Edge[] = [makeEdge('room'), makeEdge('size')];
    const out = reverbDef.codegen(ctx, {
      roomMin: 0, roomMax: 1, sizeMin: 0, sizeMax: 1,
    }, edges);
    expect(out).toContain('.room(`');
    expect(out).toContain('.size(`');
    expect(out).not.toContain('signal(');
  });
});
