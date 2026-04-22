// @vitest-environment jsdom
//
// Unit 7: port-indicator + tooltip rendering.
//
// Drives openEditor() against a real jsdom document so we can assert on the
// DOM structure produced by makePortEl() — kind badge, richer `title`, and
// `?` help affordance. These are informational only; codegen is verified by
// node-editor-codegen.test.ts and is unchanged by this unit.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeEditor,
  initNodeEditor,
  isEditorOpen,
  openEditor,
  registerNodeDef,
} from '../node-editor';
import { _resetRegistryForTests } from '../node-editor/registry';
import { _resetIdsForTests } from '../node-editor/graph';
import { registerDataNodes } from '../node-editor/nodes/data';
import { soundLpfDef } from '../node-editor/nodes/sound-basic';
import type { CanvasShape } from '../shapes';

function makeSweeperStub(id: number): CanvasShape {
  return {
    id,
    type: 'sweeper',
    sweepColor: '#C084FC',
    graph: null,
    toStrudelCode: () => `// @shape-start-${id}\n// @shape-end-${id}`,
  } as unknown as CanvasShape;
}

beforeEach(() => {
  _resetRegistryForTests();
  _resetIdsForTests();
  // Register only the defs the default-seeded graph uses (distance + lpf,
  // cluster-count + gain). Sound-basic's module side-effect already ran at
  // import time in the non-reset path; re-register after the reset.
  registerDataNodes();
  registerNodeDef(soundLpfDef);
  // Minimal `sound.gain` so the default-graph seeder can wire its second edge.
  registerNodeDef({
    type: 'sound.gain',
    side: 'sound',
    label: 'Gain',
    inputs: [{
      id: 'amp', label: 'amp', kind: 'number',
      min: 0, max: 1, unit: '0..1',
      description: 'Amp test.',
    }],
    codegen: () => '',
  });
});

afterEach(() => {
  if (isEditorOpen()) closeEditor();
});

describe('node-editor port tooltips + indicators (Unit 7)', () => {
  it('renders a kind indicator, rich title, and ? help affordance for each port', () => {
    initNodeEditor({ resolveSweeper: id => (id === 1 ? makeSweeperStub(1) : null) });
    openEditor(1);

    const ports = document.querySelectorAll('.ne-port-row');
    expect(ports.length).toBeGreaterThan(0);

    // Every port row must include indicator + help affordance.
    for (const row of Array.from(ports)) {
      expect(row.querySelector('.port-kind-indicator')).not.toBeNull();
      expect(row.querySelector('.port-help')).not.toBeNull();
    }
  });

  it('distance-to-sun output carries range, unit, and description in its tooltip', () => {
    initNodeEditor({ resolveSweeper: id => (id === 2 ? makeSweeperStub(2) : null) });
    openEditor(2);

    const distLabel = Array.from(document.querySelectorAll('.ne-port-row-out .port-label'))
      .find(el => el.textContent?.startsWith('distance'));
    expect(distLabel).toBeDefined();

    const row = distLabel!.closest('.ne-port-row')!;
    const dot = row.querySelector('.port') as HTMLElement;
    expect(dot.title).toContain('distance');
    expect(dot.title).toContain('number');
    expect(dot.title).toContain('px');
    expect(dot.title).toContain('0');
    expect(dot.title).toContain('500');
    // Full description should land in the tooltip too.
    expect(dot.title.toLowerCase()).toContain('sun');

    const indicator = row.querySelector('.port-kind-indicator') as HTMLElement;
    expect(indicator.dataset['kind']).toBe('number');
    expect(indicator.textContent).toBe('\u25CF');

    const help = row.querySelector('.port-help') as HTMLElement;
    expect(help.title.toLowerCase()).toContain('distance');
    expect(help.textContent).toBe('?');
  });

  it('lpf frequency input advertises its Hz range and description', () => {
    initNodeEditor({ resolveSweeper: id => (id === 3 ? makeSweeperStub(3) : null) });
    openEditor(3);

    const freqLabel = Array.from(document.querySelectorAll('.ne-port-row-in .port-label'))
      .find(el => el.textContent?.startsWith('frequency'));
    expect(freqLabel).toBeDefined();
    const row = freqLabel!.closest('.ne-port-row')!;
    const dot = row.querySelector('.port') as HTMLElement;
    expect(dot.title).toContain('frequency');
    expect(dot.title).toContain('Hz');
    expect(dot.title).toContain('200');
    expect(dot.title).toContain('4000');
    expect(dot.title.toLowerCase()).toContain('cutoff');
  });

  it('PortSpec metadata is optional — a minimal port still renders without throwing', () => {
    // Adding a node whose port spec carries no metadata at all. The makePortEl
    // builder must still produce the baseline structure (dot + indicator + label + help).
    _resetRegistryForTests();
    _resetIdsForTests();
    registerNodeDef({
      type: 'data.distance-to-sun',
      side: 'data',
      label: 'Distance',
      outputs: [{ id: 'distance', label: 'distance', kind: 'number' }],
      codegen: () => '',
    });
    // Re-register a bare lpf too so seedDefaultGraph can wire it.
    registerNodeDef({
      type: 'sound.lpf',
      side: 'sound',
      label: 'LPF',
      inputs: [{ id: 'frequency', label: 'frequency', kind: 'number' }],
      codegen: () => '',
    });

    initNodeEditor({ resolveSweeper: id => (id === 9 ? makeSweeperStub(9) : null) });
    openEditor(9);

    const ports = document.querySelectorAll('.ne-port-row');
    expect(ports.length).toBeGreaterThan(0);
    for (const row of Array.from(ports)) {
      expect(row.querySelector('.port-kind-indicator')).not.toBeNull();
    }
  });
});
