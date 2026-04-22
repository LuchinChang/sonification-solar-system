// src/config-snapshot.ts
//
// Portable save/load format for the sonification scene.
// ★ ShapeConfig is the single source of truth for serializable shape properties.
//   See config-snapshot.test.ts for the round-trip and property-coverage tests
//   that enforce this contract.

import type { ShapeType, PlaybackMode } from './shapes';

// ── NodeGraphSnapshot — per-sweeper node-editor graph ────────────────────────
//
// TODO(Unit 14): align with NodeGraph from src/node-editor/types.ts once Unit 4
// lands. This is a serialization-layer mirror — keep it structurally independent
// of the live NodeGraph class.

export interface NodeGraphSnapshot {
  nodes: Array<{
    id: string;
    defType: string;
    x: number;
    y: number;
    params: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    fromPort: string;
    toPort: string;
  }>;
}

// ── ShapeConfig — serializable subset of CanvasShape ─────────────────────────

/**
 * The canonical list of serializable shape properties.
 * CanvasShape.toConfig() returns this; CanvasShape.fromConfig() consumes it.
 *
 * ★ ADD NEW PERSISTENT PARAMS HERE — the round-trip test enforces coverage.
 *
 * As of v2, sweeper is the only fully supported shape type. Non-sweeper branches
 * (circle/triangle/rectangle) are being quarantined (Unit 1) — field definitions
 * are kept for potential revival but are all optional.
 */
export interface ShapeConfig {
  id: number;
  type: ShapeType;
  x: number;
  y: number;
  size: number;
  instrument: string;
  // Sweeper-only (optional)
  k?: number;
  sweepCount?: number;
  startAngle?: number;
  ticks?: number;
  fineness?: number;
  freqLow?: number;
  freqHigh?: number;
  colorIndex?: number;
  /** Per-sweeper node-graph state. Only meaningful when type === 'sweeper'. */
  graph?: NodeGraphSnapshot;
}

// ── ConfigSnapshot — full scene state ────────────────────────────────────────

export const SNAPSHOT_VERSION = 2 as const;

export interface ConfigSnapshot {
  version: typeof SNAPSHOT_VERSION;
  patternId: string;
  sampleRate: number;
  cpm: number;
  playbackMode: PlaybackMode;
  theme: 'dark' | 'light';
  shapes: ShapeConfig[];
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_TYPES = new Set<string>(['circle', 'triangle', 'rectangle', 'sweeper']);
const VALID_MODES = new Set<string>(['constant-time', 'constant-speed']);
const VALID_THEMES = new Set<string>(['dark', 'light']);

/**
 * Error describing why a snapshot was rejected. `kind === 'legacy-version'`
 * identifies pre-v2 files — callers may surface a targeted "no migration"
 * message to the user instead of a generic parse failure.
 */
export interface SnapshotRejection {
  kind: 'legacy-version' | 'invalid';
  message: string;
}

function isNodeGraphSnapshot(g: unknown): g is NodeGraphSnapshot {
  if (typeof g !== 'object' || g === null) return false;
  const gg = g as Record<string, unknown>;
  if (!Array.isArray(gg['nodes']) || !Array.isArray(gg['edges'])) return false;
  for (const n of gg['nodes'] as unknown[]) {
    if (typeof n !== 'object' || n === null) return false;
    const nn = n as Record<string, unknown>;
    if (typeof nn['id']      !== 'string') return false;
    if (typeof nn['defType'] !== 'string') return false;
    if (typeof nn['x']       !== 'number') return false;
    if (typeof nn['y']       !== 'number') return false;
    if (typeof nn['params']  !== 'object' || nn['params'] === null) return false;
  }
  for (const e of gg['edges'] as unknown[]) {
    if (typeof e !== 'object' || e === null) return false;
    const ee = e as Record<string, unknown>;
    if (typeof ee['id']       !== 'string') return false;
    if (typeof ee['fromPort'] !== 'string') return false;
    if (typeof ee['toPort']   !== 'string') return false;
  }
  return true;
}

/**
 * Strict v2-only validator. Returns `true` if `data` is a valid v2 snapshot.
 * For richer error reporting (to distinguish legacy v1 files from plain-invalid
 * input), use {@link inspectSnapshot}.
 */
export function validateSnapshot(data: unknown): data is ConfigSnapshot {
  return inspectSnapshot(data) === null;
}

/**
 * Returns `null` if the snapshot is valid v2, or a {@link SnapshotRejection}
 * describing what's wrong. Legacy v1 files get a dedicated rejection kind so
 * the UI can show a "no migration — please recreate" message rather than a
 * generic parse error.
 */
export function inspectSnapshot(data: unknown): SnapshotRejection | null {
  if (typeof data !== 'object' || data === null) {
    return { kind: 'invalid', message: 'Snapshot must be an object' };
  }
  const d = data as Record<string, unknown>;

  if (d['version'] === 1) {
    return {
      kind: 'legacy-version',
      message: 'Legacy v1 config not supported — please recreate your scene',
    };
  }
  if (d['version'] !== SNAPSHOT_VERSION) {
    return { kind: 'invalid', message: `Unsupported version: ${String(d['version'])}` };
  }
  if (typeof d['patternId'] !== 'string') return { kind: 'invalid', message: 'Invalid patternId' };
  if (typeof d['sampleRate'] !== 'number' || d['sampleRate'] < 10 || d['sampleRate'] > 2000) {
    return { kind: 'invalid', message: 'sampleRate out of range' };
  }
  if (typeof d['cpm'] !== 'number' || d['cpm'] < 5 || d['cpm'] > 100) {
    return { kind: 'invalid', message: 'cpm out of range' };
  }
  if (!VALID_MODES.has(d['playbackMode'] as string)) return { kind: 'invalid', message: 'Invalid playbackMode' };
  if (!VALID_THEMES.has(d['theme'] as string)) return { kind: 'invalid', message: 'Invalid theme' };
  if (!Array.isArray(d['shapes'])) return { kind: 'invalid', message: 'shapes must be an array' };

  for (const s of d['shapes'] as unknown[]) {
    if (typeof s !== 'object' || s === null) return { kind: 'invalid', message: 'Invalid shape entry' };
    const sh = s as Record<string, unknown>;
    if (typeof sh['id'] !== 'number') return { kind: 'invalid', message: 'Shape missing id' };
    if (!VALID_TYPES.has(sh['type'] as string)) return { kind: 'invalid', message: 'Invalid shape type' };
    if (typeof sh['x'] !== 'number' || typeof sh['y'] !== 'number') return { kind: 'invalid', message: 'Invalid shape position' };
    if (typeof sh['size'] !== 'number' || sh['size'] < 10 || sh['size'] > 500) return { kind: 'invalid', message: 'Invalid shape size' };
    if (typeof sh['instrument'] !== 'string') return { kind: 'invalid', message: 'Invalid instrument' };
    // Sweeper-only optional fields: validate if present
    if (sh['freqLow']    !== undefined && (typeof sh['freqLow']    !== 'number' || sh['freqLow']    < 20 || sh['freqLow']    > 20000)) return { kind: 'invalid', message: 'freqLow out of range' };
    if (sh['freqHigh']   !== undefined && (typeof sh['freqHigh']   !== 'number' || sh['freqHigh']   < 20 || sh['freqHigh']   > 20000)) return { kind: 'invalid', message: 'freqHigh out of range' };
    if (sh['colorIndex'] !== undefined && (typeof sh['colorIndex'] !== 'number' || sh['colorIndex'] < 0  || sh['colorIndex'] > 64))    return { kind: 'invalid', message: 'colorIndex out of range' };
    if (sh['graph']      !== undefined && !isNodeGraphSnapshot(sh['graph'])) return { kind: 'invalid', message: 'Invalid graph snapshot' };
  }

  return null;
}

// ── Download helper ──────────────────────────────────────────────────────────

export function downloadSnapshot(snapshot: ConfigSnapshot): void {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  a.href     = url;
  a.download = `sonification-${snapshot.patternId}-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
