// src/__tests__/playground-settings.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, loadSettings, saveSettings, loadUnlocked, saveUnlocked,
  settingsAsCode, NODAL_CHORD_DEFAULT_ON,
} from '../playground-settings';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(), key: () => null, length: 0,
  } as Storage;
}

describe('playground settings', () => {
  it('ships hidden until golden defaults are found', () => {
    expect(NODAL_CHORD_DEFAULT_ON).toBe(false);
  });
  it('returns defaults from empty storage', () => {
    expect(loadSettings(memStorage())).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips saved settings', () => {
    const s = memStorage();
    saveSettings(s, { ...DEFAULT_SETTINGS, operator: 'fm', f0: 220 });
    expect(loadSettings(s).operator).toBe('fm');
    expect(loadSettings(s).f0).toBe(220);
  });
  it('ignores corrupt JSON and unknown fields, clamps ranges', () => {
    const s = memStorage();
    s.setItem('nodal-playground-settings', '{nope');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    s.setItem('nodal-playground-settings',
      JSON.stringify({ f0: 99999, balance: -3, bogus: true }));
    const loaded = loadSettings(s);
    expect(loaded.f0).toBeLessThanOrEqual(1046.5);
    expect(loaded.balance).toBe(0);
    expect('bogus' in loaded).toBe(false);
  });
  it('persists the unlock flag', () => {
    const s = memStorage();
    expect(loadUnlocked(s)).toBe(false);
    saveUnlocked(s, true);
    expect(loadUnlocked(s)).toBe(true);
  });
  it('serialises current settings as a TS literal for promotion to defaults', () => {
    const code = settingsAsCode(DEFAULT_SETTINGS);
    expect(code).toContain("operator: 'add'");
    expect(code).toContain('f0: 261.63');
  });
});
