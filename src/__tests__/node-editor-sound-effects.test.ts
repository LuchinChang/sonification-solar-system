// src/__tests__/node-editor-sound-effects.test.ts
//
// Unit 9 tests: sound.distortion + sound.reverb registration, defaults, and
// codegen output (both literal-param and inbound-signal paths).

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
import type { CodegenCtx, Edge } from '../node-editor/types';

// ── Shared fixtures ──────────────────────────────────────────────────────────

/**
 * Minimal CodegenCtx stub. Unit 14 will produce the real one; here we only
 * need `sweeperId` plus passthrough helpers so the defs' codegen can run.
 */
function makeCtx(sweeperId = 7): CodegenCtx {
  return {
    sweeperId,
    nodeVar: (nodeId: string) => `sw_${sweeperId}_${nodeId}`,
    incoming: () => [],
    paramsOf: <T = Record<string, unknown>>() => ({} as T),
  };
}

function makeSignalEdge(portId: string, outPortId: string): Edge {
  return {
    id:   'e-test',
    from: { nodeId: 'n-src', portId: outPortId, dir: 'out' },
    to:   { nodeId: 'n-fx',  portId,            dir: 'in' },
  };
}

beforeEach(() => {
  // Unit 4 tests wipe + re-register per test; do the same so suites are
  // order-independent regardless of which file Vitest loads first.
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
    expect(def?.inputs).toEqual([
      { id: 'amount', label: 'amount', kind: 'number', continuous: true },
    ]);
    expect(def?.defaultParams).toEqual({ amount: 0.2 });
  });

  it('registers sound.reverb on the sound side with room + size inputs', () => {
    const def = getNodeDef('sound.reverb');
    expect(def).toBeDefined();
    expect(def?.side).toBe('sound');
    expect(def?.inputs?.map(p => p.id)).toEqual(['room', 'size']);
    expect(def?.defaultParams).toEqual({ room: 0.4, size: 0.5 });
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
  it('emits .shape(<literal>) using defaultParams.amount when no edge is wired', () => {
    const out = distortionDef.codegen(makeCtx(), { amount: 0.2 }, []);
    expect(out).toBe('.shape(0.2)');
  });

  it('respects a user-edited amount', () => {
    const out = distortionDef.codegen(makeCtx(), { amount: 0.75 }, []);
    expect(out).toBe('.shape(0.75)');
  });

  it('falls back to the default when params.amount is missing / non-numeric', () => {
    const out = distortionDef.codegen(makeCtx(), {}, []);
    expect(out).toBe('.shape(0.2)');
  });

  it('emits a signal(() => globalThis.__sw_<id>_<out>) reference when an edge is inbound', () => {
    const ctx   = makeCtx(3);
    const edge  = makeSignalEdge('amount', 'distance');
    const out   = distortionDef.codegen(ctx, { amount: 0.2 }, [edge]);
    expect(out).toBe('.shape(signal(() => globalThis.__sw_3_distance))');
  });
});

// ── Reverb codegen ───────────────────────────────────────────────────────────

describe('sound.reverb codegen', () => {
  it('emits .room(r).size(s) using defaultParams when no edges are wired', () => {
    const out = reverbDef.codegen(makeCtx(), { room: 0.4, size: 0.5 }, []);
    expect(out).toBe('.room(0.4).size(0.5)');
  });

  it('respects user-edited room + size values', () => {
    const out = reverbDef.codegen(makeCtx(), { room: 0.9, size: 0.25 }, []);
    expect(out).toBe('.room(0.9).size(0.25)');
  });

  it('supports mixing a signal input on room with a literal size', () => {
    const ctx  = makeCtx(12);
    const edge = makeSignalEdge('room', 'elevation');
    const out  = reverbDef.codegen(ctx, { room: 0.4, size: 0.5 }, [edge]);
    expect(out).toBe('.room(signal(() => globalThis.__sw_12_elevation)).size(0.5)');
  });

  it('supports signal inputs on both room and size', () => {
    const ctx   = makeCtx(4);
    const edges: Edge[] = [
      makeSignalEdge('room', 'a'),
      makeSignalEdge('size', 'b'),
    ];
    const out = reverbDef.codegen(ctx, { room: 0.4, size: 0.5 }, edges);
    expect(out).toBe(
      '.room(signal(() => globalThis.__sw_4_a)).size(signal(() => globalThis.__sw_4_b))'
    );
  });
});
