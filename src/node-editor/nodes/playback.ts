// src/node-editor/nodes/playback.ts
//
// Unit 10 — playback.mode node.
//
// Selects the sweeper arm's kinematic model:
//   - 'normal'    constant ω, wrap at 2π (legacy behaviour)
//   - 'ping-pong' reverses direction after each full cycle
//   - 'spring'    critically-damped spring towards a moving target
//
// The node has NO Strudel codegen fragment — its only side-effect is writing
// `shape.playbackMode`. Unit 14's codegen walker will call `applyPlaybackNode`
// after compiling the rest of the graph; for now, the helper is exported so
// panels (Unit 11/12) and tests can apply it directly when the node changes.

import type { CanvasShape, SweeperPlaybackMode } from '../../shapes';
import type { Node, NodeDefinition } from '../types';
import { registerNodeDef } from '../registry';

export const PLAYBACK_MODES: readonly SweeperPlaybackMode[] = ['normal', 'ping-pong', 'spring'] as const;

/** Narrow an unknown param to a valid SweeperPlaybackMode, falling back to 'normal'. */
export function coercePlaybackMode(v: unknown): SweeperPlaybackMode {
  return (PLAYBACK_MODES as readonly string[]).includes(v as string)
    ? (v as SweeperPlaybackMode)
    : 'normal';
}

/**
 * Side-effect helper: write the node's `mode` param onto a sweeper shape.
 * Resets per-mode state so switching modes doesn't leave stale velocity /
 * direction / accumulator values from the previous mode.
 */
export function applyPlaybackNode(node: Node, shape: CanvasShape): void {
  if (shape.type !== 'sweeper') return;
  const next = coercePlaybackMode(node.params['mode']);
  if (shape.playbackMode === next) return;
  shape.playbackMode       = next;
  shape.sweepDirection     = 1;
  shape.sweepPingPongAccum = 0;
  shape.springVelocity     = 0;
  shape.springTargetAngle  = shape.playheadAngle;
}

/** Inline UI — a native <select> so keyboard / screen-reader support is free. */
function buildUi(node: Node, onChange: (patch: Partial<Node>) => void): HTMLElement {
  const wrap  = document.createElement('label');
  wrap.className = 'node-editor-param';

  const caption   = document.createElement('span');
  caption.className = 'node-editor-param-label';
  caption.textContent = 'mode';

  const select = document.createElement('select');
  select.className = 'node-editor-param-select';
  for (const m of PLAYBACK_MODES) {
    const opt = document.createElement('option');
    opt.value = m;
    // Pretty labels: Normal, Ping-Pong, Spring.
    opt.textContent = m === 'ping-pong' ? 'Ping-Pong' : m.charAt(0).toUpperCase() + m.slice(1);
    if (coercePlaybackMode(node.params['mode']) === m) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    onChange({ params: { ...node.params, mode: coercePlaybackMode(select.value) } });
  });

  wrap.append(caption, select);
  return wrap;
}

export const playbackModeNode: NodeDefinition = {
  type:  'playback.mode',
  side:  'playback',
  label: 'Playback Mode',
  inputs:  [{ id: 'mode', label: 'mode', kind: 'string' }],
  outputs: [],
  defaultParams: { mode: 'normal' satisfies SweeperPlaybackMode },
  // Empty fragment — behaviour lives in stepPlayhead(), driven by shape.playbackMode.
  codegen: () => '',
  ui: buildUi,
};

/** Register the node. Safe to call once at module load. */
export function registerPlaybackModeNode(): void {
  registerNodeDef(playbackModeNode);
}
