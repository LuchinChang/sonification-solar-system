// src/config-snapshot.ts
//
// Portable save/load format for the sonification scene.
// ★ ShapeConfig is the single source of truth for serializable shape properties.
//   See config-snapshot.test.ts for the round-trip and property-coverage tests
//   that enforce this contract.

import type { ShapeType, PlaybackMode } from './shapes';

// ── ShapeConfig — serializable subset of CanvasShape ─────────────────────────

/**
 * The canonical list of serializable shape properties.
 * CanvasShape.toConfig() returns this; CanvasShape.fromConfig() consumes it.
 *
 * ★ ADD NEW PERSISTENT PARAMS HERE — the round-trip test enforces coverage.
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
  freqLow?: number;
  freqHigh?: number;
  colorIndex?: number;
}

// ── ConfigSnapshot — full scene state ────────────────────────────────────────

export interface ConfigSnapshot {
  version: 1;
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

export function validateSnapshot(data: unknown): data is ConfigSnapshot {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;

  if (d['version'] !== 1) return false;
  if (typeof d['patternId'] !== 'string') return false;
  if (typeof d['sampleRate'] !== 'number' || d['sampleRate'] < 10 || d['sampleRate'] > 2000) return false;
  if (typeof d['cpm'] !== 'number' || d['cpm'] < 5 || d['cpm'] > 100) return false;
  if (!VALID_MODES.has(d['playbackMode'] as string)) return false;
  if (!VALID_THEMES.has(d['theme'] as string)) return false;
  if (!Array.isArray(d['shapes'])) return false;

  for (const s of d['shapes'] as unknown[]) {
    if (typeof s !== 'object' || s === null) return false;
    const sh = s as Record<string, unknown>;
    if (typeof sh['id'] !== 'number') return false;
    if (!VALID_TYPES.has(sh['type'] as string)) return false;
    if (typeof sh['x'] !== 'number' || typeof sh['y'] !== 'number') return false;
    if (typeof sh['size'] !== 'number' || sh['size'] < 10 || sh['size'] > 500) return false;
    if (typeof sh['instrument'] !== 'string') return false;
    // Sweeper-only optional fields: validate if present
    if (sh['freqLow']    !== undefined && (typeof sh['freqLow']    !== 'number' || sh['freqLow']    < 20 || sh['freqLow']    > 20000)) return false;
    if (sh['freqHigh']   !== undefined && (typeof sh['freqHigh']   !== 'number' || sh['freqHigh']   < 20 || sh['freqHigh']   > 20000)) return false;
    if (sh['colorIndex'] !== undefined && (typeof sh['colorIndex'] !== 'number' || sh['colorIndex'] < 0  || sh['colorIndex'] > 64))    return false;
  }

  return true;
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
