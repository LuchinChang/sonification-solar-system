// src/audio.ts
//
// Strudel audio lifecycle: REPL creation, live code evaluation,
// AudioContext management, and sample loading.

import { repl, evalScope } from '@strudel/core';
import { initAudioOnFirstClick, initAudio, getAudioContext, webaudioOutput, registerSynthSounds } from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';
import type { StrudelRepl } from './state';

// ── Typed sample loader ──────────────────────────────────────────────────────
// Replaces the `(globalThis as Record<string, unknown>)['samples']` cast chain.

type SampleLoaderUrl = (url: string) => Promise<void>;
type SampleLoaderObj = (obj: Record<string, string[]>) => Promise<void>;

// ── AudioContext safe wrappers ───────────────────────────────────────────────
// Consolidates 3 duplicated `try { getAudioContext().resume() } catch (_) {}` patterns.

export function resumeAudioContext(): void {
  try {
    void getAudioContext().resume();
  } catch (e) {
    console.debug('[audio] resume unavailable:', e);
  }
}

export function suspendAudioContext(): void {
  try {
    void getAudioContext().suspend();
  } catch (e) {
    console.debug('[audio] suspend unavailable:', e);
  }
}

export function getAudioTime(): number {
  try {
    return getAudioContext().currentTime;
  } catch (e) {
    console.debug('[audio] currentTime unavailable:', e);
    return 0;
  }
}

// ── Strudel REPL initialization ──────────────────────────────────────────────

export async function initializeAudio(): Promise<StrudelRepl> {
  initAudioOnFirstClick();
  const ac = getAudioContext();
  if (ac.state === 'suspended') await ac.resume();

  await initAudio();
  registerSynthSounds();

  await evalScope(
    import('@strudel/core'),
    import('@strudel/webaudio'),
    import('@strudel/mini'),
  );

  // Load samples using the properly typed global loader
  const globalSamples = (globalThis as Record<string, unknown>)['samples'];
  if (typeof globalSamples === 'function') {
    const loadUrl = globalSamples as SampleLoaderUrl;
    const loadObj = globalSamples as SampleLoaderObj;

    loadUrl('github:tidalcycles/Dirt-Samples/main')
      .catch(() => console.warn('[audio] Drum samples unavailable (offline?)'));

    const bassBase = 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_bass-mp3/';
    loadObj({
      gm_acoustic_bass: ['A1','C2','E2','G2','A2','C3','E3','G3','A3','C4']
        .map(n => bassBase + n + '.mp3'),
    }).catch(() => console.warn('[audio] Bass samples unavailable (offline?)'));

    const pianoBase = 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite/acoustic_grand_piano-mp3/';
    loadObj({
      superpiano: ['C3','E3','G3','C4','E4','G4','C5','E5','G5','C6']
        .map(n => pianoBase + n + '.mp3'),
    }).catch(() => console.warn('[audio] Piano samples unavailable (offline?)'));
  }

  const strudelRepl = repl({
    defaultOutput: webaudioOutput,
    getTime: () => ac.currentTime,
    transpiler,
  }) as unknown as StrudelRepl;

  return strudelRepl;
}

// ── Live code evaluation ─────────────────────────────────────────────────────

export function playLiveCode(
  strudelRepl: StrudelRepl | null,
  codeString: string,
  autostart = true,
): Promise<'ok' | 'error'> {
  if (!strudelRepl) return Promise.resolve('error');
  try {
    return strudelRepl.evaluate(codeString, autostart).then(() => {
      return 'ok' as const;
    }).catch((err: unknown) => {
      console.warn('[strudel-eval async]', err);
      return 'error' as const;
    });
  } catch (error) {
    console.warn('[strudel-eval]', error);
    return Promise.resolve('error');
  }
}

/** Sync Strudel scheduler tempo to our UI CPM value. */
export function syncStrudelCps(strudelRepl: StrudelRepl | null, cpm: number): void {
  if (strudelRepl !== null) {
    strudelRepl.setCps(cpm / 60);
  }
}
