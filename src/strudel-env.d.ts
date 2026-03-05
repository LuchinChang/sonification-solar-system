// Type declarations for Strudel packages (ship without .d.ts files).
// We only declare the surface area used in main.ts; all other
// exports are loaded onto globalThis via evalScope at runtime.

declare module '@strudel/core' {
  export function evalScope(...modules: unknown[]): Promise<unknown[]>;
  export function repl(options: {
    defaultOutput: any;
    getTime: () => number;
    transpiler?: (code: string) => string;
    [key: string]: unknown;
  }): {
    evaluate(code: string, autostart?: boolean, shouldHush?: boolean): Promise<unknown>;
    start(): void;
    stop(): void;
    pause(): void;
    toggle(): void;
    setCps(cps: number): void;
    scheduler: { cps: number };
    state: {
      started: boolean;
      error?: Error;
      evalError?: Error;
      schedulerError?: Error;
    };
  };
}

declare module '@strudel/webaudio' {
  export function getAudioContext(): AudioContext;
  export function initAudioOnFirstClick(): void;
  export function initAudio(options?: Record<string, unknown>): Promise<void>;
  export const webaudioOutput: any;
  /** Registers oscillator-based synths (square, sawtooth, sine, etc.) into superdough's sound registry. */
  export function registerSynthSounds(): void;
}

declare module '@strudel/mini' {
  // Loaded via evalScope at runtime; registers m() globally for the transpiler
}

declare module '@strudel/transpiler' {
  export function transpiler(code: string): string;
  export function evaluate(code: string): Promise<any>;
}
