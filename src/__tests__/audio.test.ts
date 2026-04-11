// src/__tests__/audio.test.ts
//
// Tests for audio module: live code evaluation and CPS sync.

import { describe, it, expect, vi } from 'vitest';
import { playLiveCode, syncStrudelCps } from '../audio';
import type { StrudelRepl } from '../state';

function mockRepl(evaluateResult: 'ok' | 'error' = 'ok'): StrudelRepl {
  return {
    evaluate: vi.fn().mockImplementation(() =>
      evaluateResult === 'ok'
        ? Promise.resolve()
        : Promise.reject(new Error('compile error')),
    ),
    start: vi.fn(),
    stop: vi.fn(),
    setCps: vi.fn(),
  };
}

describe('playLiveCode', () => {
  it('calls repl.evaluate with correct args', async () => {
    const r = mockRepl();
    const result = await playLiveCode(r, 'note("c3")', true);
    expect(r.evaluate).toHaveBeenCalledWith('note("c3")', true);
    expect(result).toBe('ok');
  });

  it('returns error when evaluation fails', async () => {
    const r = mockRepl('error');
    const result = await playLiveCode(r, 'bad code');
    expect(result).toBe('error');
  });

  it('returns error when repl is null', async () => {
    const result = await playLiveCode(null, 'any code');
    expect(result).toBe('error');
  });

  it('defaults autostart to true', async () => {
    const r = mockRepl();
    await playLiveCode(r, 'note("c3")');
    expect(r.evaluate).toHaveBeenCalledWith('note("c3")', true);
  });

  it('passes autostart=false when specified', async () => {
    const r = mockRepl();
    await playLiveCode(r, 'note("c3")', false);
    expect(r.evaluate).toHaveBeenCalledWith('note("c3")', false);
  });
});

describe('syncStrudelCps', () => {
  it('calls setCps with cpm/60', () => {
    const r = mockRepl();
    syncStrudelCps(r, 120);
    expect(r.setCps).toHaveBeenCalledWith(2); // 120/60 = 2
  });

  it('is a no-op when repl is null', () => {
    // Should not throw
    syncStrudelCps(null, 60);
  });

  it('converts 60 CPM to 1 CPS', () => {
    const r = mockRepl();
    syncStrudelCps(r, 60);
    expect(r.setCps).toHaveBeenCalledWith(1);
  });
});
