// Type declarations for Strudel packages (ship without .d.ts files).
// We only declare the surface area used in main.ts; all other
// exports are loaded onto globalThis via evalScope at runtime.

declare module '@strudel/core' {
  export function evalScope(...modules: unknown[]): Promise<unknown[]>;
}

declare module '@strudel/webaudio' {
  export interface StrudelRepl {
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
  }

  export function webaudioRepl(options?: {
    transpiler?: (code: string, options?: unknown) => { output: string };
    [key: string]: unknown;
  }): StrudelRepl;

  export function initAudio(options?: Record<string, unknown>): Promise<void>;
  export function getAudioContext(): AudioContext;
}
