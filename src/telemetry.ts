// src/telemetry.ts
//
// Strudel code generation from shapes and surgical textarea patching.
// Pure string operations — no audio or DOM coupling beyond the textarea.

import type { CanvasShape } from './shapes';
import type { AppState } from './state';
import { FLASH_COOLDOWN_MS } from './state';
import type { DomElements } from './dom';

// ── Full code generation ─────────────────────────────────────────────────────

export function generateFullCode(
  shapes: CanvasShape[],
  patternName: string,
  sampleRate: number,
  cpm: number,
): string {
  const header = [
    '// Solar System Sonification \u2014 Live Code',
    '// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
    `// Pattern: ${patternName}  |  Shapes: ${shapes.length}  |  Samples: ${sampleRate}  |  CPM: ${cpm}`,
    '',
  ].join('\n');

  if (shapes.length === 0) {
    return header + '// Spawn shapes from the Sonic Foundry dock.';
  }
  return header + shapes.map(s => s.toStrudelCode()).join('\n\n');
}

// ── Surgical textarea patch functions ────────────────────────────────────────
//
// These preserve user edits to pattern lines while updating only
// what the geometry engine owns (the rhythm string or full block).

export function patchRhythm(textarea: HTMLTextAreaElement, shape: CanvasShape): void {
  const v      = `r_${shape.id}`;
  const marker = `// @rhythm-${shape.id}`;
  const regex   = new RegExp(`const ${v} = \`[\\s\\S]*?\`; ${marker}`);
  const newLine = `const ${v} = \`${shape.generateRhythmString()}\`; ${marker}`;
  const current = textarea.value;
  const patched = current.replace(regex, newLine);
  if (patched !== current) textarea.value = patched;
}

export function patchShapeBlock(
  textarea: HTMLTextAreaElement,
  shape: CanvasShape,
  shapes: CanvasShape[],
  patternName: string,
  sampleRate: number,
  cpm: number,
): void {
  const start = `// @shape-start-${shape.id}`;
  const end   = `// @shape-end-${shape.id}`;
  const regex = new RegExp(`${start}[\\s\\S]*?${end}`);
  const current = textarea.value;
  if (regex.test(current)) {
    textarea.value = current.replace(regex, shape.toStrudelCode());
  } else {
    textarea.value = generateFullCode(shapes, patternName, sampleRate, cpm);
  }
}

export function patchHeader(
  textarea: HTMLTextAreaElement,
  patternName: string,
  shapeCount: number,
  sampleRate: number,
  cpm: number,
): void {
  const newHeader = `// Pattern: ${patternName}  |  Shapes: ${shapeCount}  |  Samples: ${sampleRate}  |  CPM: ${cpm}`;
  textarea.value = textarea.value.replace(
    /\/\/ Pattern: .+  \|  Shapes: \d+  \|  Samples: \d+  \|  CPM: \d+/,
    newHeader,
  );
}

export function patchAllRhythms(
  textarea: HTMLTextAreaElement,
  shapes: CanvasShape[],
  patternName: string,
  sampleRate: number,
  cpm: number,
): void {
  for (const s of shapes) patchRhythm(textarea, s);
  patchHeader(textarea, patternName, shapes.length, sampleRate, cpm);
}

/** After linkLines change, re-emit Strudel blocks for sweeper shapes. */
export function rebuildSweeperPatterns(
  textarea: HTMLTextAreaElement,
  shapes: CanvasShape[],
  patternName: string,
  sampleRate: number,
  cpm: number,
): boolean {
  let hasSweeper = false;
  for (const s of shapes) {
    if (s.type === 'sweeper') {
      patchShapeBlock(textarea, s, shapes, patternName, sampleRate, cpm);
      hasSweeper = true;
    }
  }
  return hasSweeper;
}

// ── Full regeneration (add/delete) ───────────────────────────────────────────

export function updateTelemetry(dom: DomElements, state: AppState): void {
  dom.telemetryTextarea.value = generateFullCode(
    state.shapes,
    state.currentPattern.name,
    state.sampleRate,
    state.cpm,
  );
}

// ── Eval status indicator ────────────────────────────────────────────────────

export function setEvalStatus(evalStatusEl: HTMLElement, status: 'ok' | 'error' | 'idle'): void {
  evalStatusEl.className = `eval-status ${status}`;
  evalStatusEl.textContent = status === 'ok' ? '\u2713 synced' : status === 'error' ? '\u2717 error' : '';
}

// ── Flash feedback ───────────────────────────────────────────────────────────

export function flashTelemBlock(
  evalStatusEl: HTMLElement,
  flashCooldowns: Map<number, number>,
  shapeId: number,
  now: number,
): void {
  const last = flashCooldowns.get(shapeId) ?? 0;
  if (now - last < FLASH_COOLDOWN_MS) return;
  flashCooldowns.set(shapeId, now);
  evalStatusEl.classList.remove('telem-flash');
  void evalStatusEl.offsetWidth;
  evalStatusEl.classList.add('telem-flash');
}

// ── Panel toggle ─────────────────────────────────────────────────────────────

export function toggleTelemetry(dom: DomElements): boolean {
  const collapsed = dom.telemetryPanel.classList.toggle('collapsed');
  dom.telemetryTab.setAttribute('aria-expanded', String(!collapsed));
  return !collapsed; // returns true if panel is now open
}
