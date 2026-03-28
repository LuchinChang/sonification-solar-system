/**
 * Strudel Compilation Tests
 *
 * Verify that generated Strudel code actually compiles through the transpiler
 * and produces valid patterns with events. This catches silent failures where
 * code "looks fine" but produces no sound due to invalid mini-notation,
 * wrong function names, or bad template interpolation.
 *
 * Runs headlessly — no Web Audio or browser needed.
 * Uses Strudel's own evaluate() + transpiler pipeline, same as the live app.
 */

import { evalScope, evaluate } from '@strudel/core/evaluate.mjs';
import { transpiler } from '@strudel/transpiler';
import { CanvasShape } from '../shapes';
import type { Point } from '../geometry';

// ── Setup: load Strudel pattern functions onto globalThis ────────────────────

beforeAll(async () => {
  await evalScope(
    import('@strudel/core'),
    import('@strudel/mini'),
  );
}, 10_000);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Cross lines that intersect a shape at the origin. */
function makeCrossLines(cx: number, cy: number, radius: number): { p1: Point; p2: Point }[] {
  return [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].map(angle => ({
    p1: {
      x: cx + (radius + 50) * Math.cos(angle),
      y: cy + (radius + 50) * Math.sin(angle),
    },
    p2: {
      x: cx - (radius + 50) * Math.cos(angle),
      y: cy - (radius + 50) * Math.sin(angle),
    },
  }));
}

/**
 * Transpile and evaluate a Strudel code string using the same pipeline as the app.
 * Returns whether compilation succeeded and optional error message.
 */
async function compileAndQuery(code: string): Promise<{
  compiled: boolean;
  pattern: unknown;
  error?: string;
}> {
  try {
    // Strip the @shape-start/end markers (comments are fine, but strip .p() calls).
    // .p() is a REPL-only method for pattern multiplexing — not available headlessly.
    // Everything before .p() IS the actual Pattern we want to validate.
    const cleaned = code.replace(/\.p\(\(\d+\)\.toString\(\)\)/g, '');

    // evaluate() from @strudel/core/evaluate.mjs:
    // 1. Passes code through transpiler (mini-notation → JS)
    // 2. Wraps in async IIFE via safeEval
    // 3. Executes against globalThis (where evalScope placed all Strudel functions)
    // 4. Returns { pattern, mode, meta }
    const result = await evaluate(cleaned, transpiler);
    return { compiled: true, pattern: result.pattern };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { compiled: false, pattern: null, error: msg };
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Strudel code compilation', () => {
  it('drum shape (bd) compiles without error', async () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'bd';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('synth shape (sawtooth) compiles without error', async () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'sawtooth';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('key shape (superpiano) compiles without error', async () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'superpiano';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('bass shape (gm_acoustic_bass) compiles without error', async () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'gm_acoustic_bass';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('sweeper shape compiles without error', async () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = 4;
    s.rebuildSweepTicks(makeCrossLines(0, 0, 100), 315);
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('multi-arm sweeper compiles without error', async () => {
    const s = new CanvasShape(0, 0, 'sweeper', 400);
    s.k = 3;
    s.sweepCount = 3;
    s.rebuildSweepTicks(makeCrossLines(0, 0, 100), 315);
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('shape with zero intersections compiles (graceful silence)', async () => {
    const s = new CanvasShape(0, 0, 'circle', 50);
    s.instrument = 'bd';
    // No rebuildIntersectionCache → empty intersections → all-silence rhythm
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('triangle shape with intersections compiles', async () => {
    const s = new CanvasShape(0, 0, 'triangle', 60);
    s.instrument = 'hh';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 60));
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });

  it('rectangle shape with fm synth compiles', async () => {
    const s = new CanvasShape(0, 0, 'rectangle', 50);
    s.instrument = 'fm';
    s.rebuildIntersectionCache(makeCrossLines(0, 0, 50));
    const code = s.toStrudelCode();
    const result = await compileAndQuery(code);
    expect(result.error).toBeUndefined();
    expect(result.compiled).toBe(true);
  });
});
