// src/__tests__/node-editor-playback.test.ts
//
// Unit 10 tests — playback.mode node + stepPlayhead variants.
//
// Covers:
//   1. Node registration / default params.
//   2. applyPlaybackNode side-effects onto a CanvasShape.
//   3. stepPlayhead('normal')    — linear advance, wraps at 2π.
//   4. stepPlayhead('ping-pong') — direction flips after a full cycle of travel.

import { beforeEach, describe, expect, it } from 'vitest';
import { CanvasShape } from '../shapes';
import {
  playbackModeNode,
  registerPlaybackModeNode,
  applyPlaybackNode,
  coercePlaybackMode,
  PLAYBACK_MODES,
} from '../node-editor/nodes/playback';
import { getNodeDef, _resetRegistryForTests } from '../node-editor/registry';
import { _resetIdsForTests, createGraph, addNode } from '../node-editor/graph';

beforeEach(() => {
  _resetRegistryForTests();
  _resetIdsForTests();
});

// ── Registration ─────────────────────────────────────────────────────────────

describe('playback.mode node', () => {
  it('registers with the expected type, side, inputs, and defaults', () => {
    registerPlaybackModeNode();
    const def = getNodeDef('playback.mode');
    expect(def).toBe(playbackModeNode);
    expect(def?.side).toBe('playback');
    expect(def?.inputs).toEqual([{ id: 'mode', label: 'mode', kind: 'string' }]);
    expect(def?.defaultParams).toEqual({ mode: 'normal' });
  });

  it('codegen returns an empty string (behaviour lives in stepPlayhead + compileGraphToStrudel)', () => {
    registerPlaybackModeNode();
    const emit = playbackModeNode.codegen(
      {
        sweeperId: 1,
        nodeVar:   () => 'x',
        incoming:  () => [],
        paramsOf:  <T,>() => ({} as T),
        resolveInboundStack: () => null,
      },
      { mode: 'ping-pong' },
      [],
    );
    expect(emit).toBe('');
  });

  it('coercePlaybackMode rejects unknown values (including removed Spring)', () => {
    expect(coercePlaybackMode('normal')).toBe('normal');
    expect(coercePlaybackMode('ping-pong')).toBe('ping-pong');
    expect(coercePlaybackMode('spring')).toBe('normal');     // Spring removed → coerces to default
    expect(coercePlaybackMode('turbo')).toBe('normal');
    expect(coercePlaybackMode(null)).toBe('normal');
    expect(coercePlaybackMode(undefined)).toBe('normal');
  });

  it('PLAYBACK_MODES enumerates only normal + ping-pong', () => {
    expect([...PLAYBACK_MODES].sort()).toEqual(['normal', 'ping-pong']);
  });
});

// ── applyPlaybackNode ────────────────────────────────────────────────────────

describe('applyPlaybackNode', () => {
  it('writes a valid mode onto the shape', () => {
    registerPlaybackModeNode();
    const g = createGraph(1);
    const n = addNode(g, { type: 'playback.mode', side: 'playback', x: 0, y: 0, params: { mode: 'ping-pong' } });
    const s = new CanvasShape(0, 0, 'sweeper');
    applyPlaybackNode(n, s);
    expect(s.playbackMode).toBe('ping-pong');
  });

  it('resets per-mode state when switching modes', () => {
    registerPlaybackModeNode();
    const g = createGraph(1);
    const s = new CanvasShape(0, 0, 'sweeper');

    // Simulate prior ping-pong state that should be cleared.
    s.playbackMode       = 'ping-pong';
    s.sweepDirection     = -1;
    s.sweepPingPongAccum = 4.2;

    const n = addNode(g, { type: 'playback.mode', side: 'playback', x: 0, y: 0, params: { mode: 'normal' } });
    applyPlaybackNode(n, s);

    expect(s.playbackMode).toBe('normal');
    expect(s.sweepDirection).toBe(1);
    expect(s.sweepPingPongAccum).toBe(0);
  });

  it('is idempotent when the mode is unchanged', () => {
    registerPlaybackModeNode();
    const g = createGraph(1);
    const s = new CanvasShape(0, 0, 'sweeper');
    s.sweepDirection = -1;                // pretend we're mid-ping-pong swing
    s.playbackMode   = 'normal';           // currently normal
    const n = addNode(g, { type: 'playback.mode', side: 'playback', x: 0, y: 0, params: { mode: 'normal' } });
    applyPlaybackNode(n, s);
    // Direction NOT reset because mode didn't change.
    expect(s.sweepDirection).toBe(-1);
  });
});

// ── stepPlayhead: 'normal' mode ──────────────────────────────────────────────

describe("stepPlayhead('normal')", () => {
  it('advances linearly at ω*dt in mode=normal', () => {
    const s = new CanvasShape(0, 0, 'sweeper');
    s.playbackMode  = 'normal';
    s.playheadAngle = 0;
    // CPM=60 → period=1s → full 2π per 1000ms; 500ms → π radians.
    s.stepPlayhead(500, 60);
    expect(s.playheadAngle).toBeCloseTo(Math.PI, 5);
  });

  it('wraps at 2π', () => {
    const s = new CanvasShape(0, 0, 'sweeper');
    s.playbackMode  = 'normal';
    s.playheadAngle = 0;
    s.stepPlayhead(1500, 60);   // 1.5 cycles
    expect(s.playheadAngle).toBeGreaterThanOrEqual(0);
    expect(s.playheadAngle).toBeLessThan(Math.PI * 2);
    expect(s.playheadAngle).toBeCloseTo(Math.PI, 5);
  });
});

// ── stepPlayhead: 'ping-pong' mode ───────────────────────────────────────────

describe("stepPlayhead('ping-pong')", () => {
  it('reverses direction after a full 2π of accumulated travel', () => {
    const s = new CanvasShape(0, 0, 'sweeper');
    s.playbackMode      = 'ping-pong';
    s.playheadAngle     = 0;
    s.sweepDirection    = 1;
    s.sweepPingPongAccum = 0;

    // CPM=60 → 2π per 1000ms. Step 999ms → accumulator just shy of 2π.
    s.stepPlayhead(999, 60);
    expect(s.sweepDirection).toBe(1);

    // One more step pushes us past 2π → flip.
    s.stepPlayhead(10, 60);
    expect(s.sweepDirection).toBe(-1);
  });

  it('retreats when direction is -1', () => {
    const s = new CanvasShape(0, 0, 'sweeper');
    s.playbackMode      = 'ping-pong';
    s.playheadAngle     = Math.PI;
    s.sweepDirection    = -1;
    s.sweepPingPongAccum = 0;
    s.stepPlayhead(100, 60);
    // With ω*dt = 2π * 0.1 = 0.628… and direction = -1, angle should decrease.
    expect(s.playheadAngle).toBeLessThan(Math.PI);
  });

  it('wraps negative angles back into [0, 2π)', () => {
    const s = new CanvasShape(0, 0, 'sweeper');
    s.playbackMode      = 'ping-pong';
    s.playheadAngle     = 0.1;
    s.sweepDirection    = -1;
    s.sweepPingPongAccum = 0;
    s.stepPlayhead(500, 60);   // π rad backwards
    expect(s.playheadAngle).toBeGreaterThanOrEqual(0);
    expect(s.playheadAngle).toBeLessThan(Math.PI * 2);
  });
});

// ── Non-sweeper safety ──────────────────────────────────────────────────────

describe('applyPlaybackNode on non-sweeper', () => {
  // Construct a sweeper then pretend its type is something else; we only want
  // to prove the guard short-circuits. We can't widen ShapeType in TS, so
  // exercise the runtime guard via a cast.
  it('no-ops when shape.type !== sweeper', () => {
    registerPlaybackModeNode();
    const g = createGraph(1);
    const n = addNode(g, { type: 'playback.mode', side: 'playback', x: 0, y: 0, params: { mode: 'ping-pong' } });
    const s = new CanvasShape(0, 0, 'sweeper');
    (s as unknown as { type: string }).type = 'circle';
    applyPlaybackNode(n, s);
    expect(s.playbackMode).toBe('normal');   // unchanged default
  });
});
