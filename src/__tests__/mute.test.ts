// src/__tests__/mute.test.ts
//
// Tests for the mute persistence helpers (pure — storage is injected).

import { describe, it, expect } from 'vitest';
import { MUTE_STORAGE_KEY, loadMuted, saveMuted } from '../mute';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  };
}

describe('mute persistence', () => {
  it('defaults to unmuted when nothing is stored', () => {
    expect(loadMuted(memoryStorage())).toBe(false);
  });

  it('round-trips muted=true', () => {
    const s = memoryStorage();
    saveMuted(s, true);
    expect(loadMuted(s)).toBe(true);
  });

  it('round-trips muted=false after true', () => {
    const s = memoryStorage();
    saveMuted(s, true);
    saveMuted(s, false);
    expect(loadMuted(s)).toBe(false);
  });

  it('uses a stable storage key', () => {
    expect(MUTE_STORAGE_KEY).toBe('sound-muted');
  });
});
