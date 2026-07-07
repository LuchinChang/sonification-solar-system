// src/mute.ts
//
// Muted ≠ Paused (see CONTEXT.md): muted keeps the engine running at zero
// volume; paused stops playback time. This module owns only the persisted
// muted *preference* — the actual gain change lives in audio.ts (setMuted).

export const MUTE_STORAGE_KEY = 'sound-muted';

export function loadMuted(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(MUTE_STORAGE_KEY) === 'true';
}

export function saveMuted(storage: Pick<Storage, 'setItem'>, muted: boolean): void {
  storage.setItem(MUTE_STORAGE_KEY, String(muted));
}
