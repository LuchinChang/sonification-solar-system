// src/__tests__/discrete-probe.test.ts
//
// End-to-end coverage for the revived DISCRETE PROBE (circle) pipeline:
//
//   bakeDiscreteTicks (angle-binned crossings)
//     → data.collision (0/1 gate stack)  → sound.rhythm (.struct mask)
//     → data.distance-to-sun (pitch)     → sound.pitch  (.note pattern)
//     → compileGraphToStrudel (value-first, struct chained last)
//
// Geometry fixture: Sun at the origin; a circle centred at (200, 0) with
// radius 50; one horizontal link-line along y = 0. The line crosses the
// perimeter at (150, 0) and (250, 0):
//   • (250,0): angle 0 from the circle centre, distance-to-Sun 250
//   • (150,0): angle π,                         distance-to-Sun 150
// With startAngle = 0 and ticks = 8 (step = π/4) those bin to tick 0 and
// tick 4 — every other tick is empty (a rest).

import { beforeEach, describe, expect, it } from 'vitest';
import { CanvasShape } from '../shapes';
import { addEdge, addNode, compileGraphToStrudel, createGraph } from '../node-editor';
import { _resetIdsForTests } from '../node-editor/graph';
import { _resetRegistryForTests, getNodeDef, listNodeDefs } from '../node-editor/registry';
import { registerDataNodes } from '../node-editor/nodes/data';
import { registerSoundBasicNodes } from '../node-editor/nodes/sound-basic';
import { defAppliesToProbe } from '../node-editor/toolbox';
import type { NodeGraph } from '../node-editor';

const SUN = { x: 0, y: 0 };
const LINKS = [{ p1: { x: 0, y: 0 }, p2: { x: 400, y: 0 } }];
const MAXR = 400;

function makeCircle(): CanvasShape {
  const c = new CanvasShape(200, 0, 'circle', 50);
  c.startAngle = 0;     // tick 0 points along +x for predictable binning
  c.ticks = 8;
  c.k = 4;
  c.instrument = 'sine';
  c.bakeDiscreteTicks(LINKS, SUN, MAXR);
  return c;
}

beforeEach(() => {
  _resetRegistryForTests();
  _resetIdsForTests();
  registerDataNodes();
  registerSoundBasicNodes();
});

// ── bakeDiscreteTicks ─────────────────────────────────────────────────────────

describe('bakeDiscreteTicks', () => {
  it('bins the two crossings to tick 0 and tick 4, others empty', () => {
    const c = makeCircle();
    expect(c.sweepTicks.length).toBe(1);            // single playhead (arm 0)
    const ticks = c.sweepTicks[0];
    expect(ticks.length).toBe(8);
    const occupied = ticks.map(t => t.length);
    expect(occupied).toEqual([1, 0, 0, 0, 1, 0, 0, 0]);
    expect(c.intersectionCount).toBe(2);
  });

  it('measures distance to the Sun, not the (constant) shape radius', () => {
    const c = makeCircle();
    expect(c.sweepTicks[0][0][0].distance).toBeCloseTo(250); // (250,0) → Sun
    expect(c.sweepTicks[0][4][0].distance).toBeCloseTo(150); // (150,0) → Sun
  });

  it('forces sweepCount to 1 and records maxR', () => {
    const c = makeCircle();
    expect(c.sweepCount).toBe(1);
    expect(c.sweepMaxR).toBe(MAXR);
  });
});

// ── data.collision ────────────────────────────────────────────────────────────

describe('data.collision', () => {
  it('returns 1 where a crossing exists, 0 otherwise', () => {
    const c = makeCircle();
    const def = getNodeDef('data.collision')!;
    const at = (tick: number) => def.perTickValue!(c, 0, tick, 0, MAXR);
    expect(at(0)).toBe(1);
    expect(at(4)).toBe(1);
    expect(at(1)).toBe(0);
    expect(at(7)).toBe(0);
  });

  it('is restricted to discrete circle probes', () => {
    const def = getNodeDef('data.collision')!;
    expect(def.appliesTo).toEqual(['circle']);
    expect(defAppliesToProbe(def, 'circle')).toBe(true);
    expect(defAppliesToProbe(def, 'sweeper')).toBe(false);
  });
});

// ── sound.rhythm ──────────────────────────────────────────────────────────────

describe('sound.rhythm', () => {
  it('is discrete-only and chains last (tailOrder)', () => {
    const def = getNodeDef('sound.rhythm')!;
    expect(def.appliesTo).toEqual(['circle']);
    expect(def.tailOrder).toBeGreaterThan(0);
  });
});

// ── Full discrete graph compilation ───────────────────────────────────────────

function seedDiscreteGraph(id: number): NodeGraph {
  const g = createGraph(id);
  const coll = addNode(g, { type: 'data.collision',       side: 'data',  x: 0, y: 0 });
  const rhy  = addNode(g, { type: 'sound.rhythm',         side: 'sound', x: 1, y: 0 });
  const dist = addNode(g, { type: 'data.distance-to-sun', side: 'data',  x: 0, y: 1 });
  const pit  = addNode(g, { type: 'sound.pitch',          side: 'sound', x: 1, y: 1 });
  addEdge(g, { from: { nodeId: coll.id, portId: 'gate',     dir: 'out' }, to: { nodeId: rhy.id, portId: 'gate', dir: 'in' } });
  addEdge(g, { from: { nodeId: dist.id, portId: 'distance', dir: 'out' }, to: { nodeId: pit.id, portId: 'note', dir: 'in' } });
  return g;
}

describe('compileGraphToStrudel — discrete circle', () => {
  it('emits a pitched, rhythm-gated voice (note + .struct)', () => {
    const c = makeCircle();
    const out = compileGraphToStrudel(c.id, seedDiscreteGraph(c.id), c);
    expect(out).toContain('note(');
    expect(out).toContain('.struct(');
    expect(out).toContain(`s("sine")`);
    expect(out).toContain('[Circle');     // type-aware block label
  });

  it('puts .struct AFTER note in each voice (value-first ordering)', () => {
    const c = makeCircle();
    const out = compileGraphToStrudel(c.id, seedDiscreteGraph(c.id), c);
    // First voice only (before the first .stack); both fragments live here.
    // The head fragment has its leading dot stripped, so it reads `note(`.
    const firstVoice = out.split('.stack(')[0];
    expect(firstVoice.indexOf('note(')).toBeGreaterThanOrEqual(0);
    expect(firstVoice.indexOf('.struct(')).toBeGreaterThan(firstVoice.indexOf('note('));
  });

  it('bakes a struct mask with hits exactly at the crossing ticks', () => {
    const c = makeCircle();
    const out = compileGraphToStrudel(c.id, seedDiscreteGraph(c.id), c);
    const m = out.match(/\.struct\(`([^`]*)`\)/);
    expect(m).not.toBeNull();
    const tokens = m![1].trim().split(/\s+/);
    expect(tokens).toHaveLength(8);
    expect(tokens).toEqual(['1', '~', '~', '~', '1', '~', '~', '~']);
  });
});

// ── Palette filtering: sweepers never see the discrete nodes ──────────────────

describe('discrete-only palette', () => {
  it('hides Collision / Rhythm from a sweeper, shows them for a circle', () => {
    const visibleFor = (type: 'sweeper' | 'circle') =>
      listNodeDefs()
        .filter(d => defAppliesToProbe(d, type))
        .map(d => d.type);
    expect(visibleFor('circle')).toContain('data.collision');
    expect(visibleFor('circle')).toContain('sound.rhythm');
    expect(visibleFor('sweeper')).not.toContain('data.collision');
    expect(visibleFor('sweeper')).not.toContain('sound.rhythm');
    // Shared nodes stay available to both.
    expect(visibleFor('sweeper')).toContain('data.distance-to-sun');
    expect(visibleFor('circle')).toContain('data.distance-to-sun');
  });
});
