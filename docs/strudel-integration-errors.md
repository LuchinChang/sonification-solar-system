# Strudel Audio Integration — Error Log & Fix Reference

> **Project:** Solar System Sonification
> **Stack:** Vite + TypeScript, `@strudel/core`, `@strudel/webaudio`, `@strudel/mini`, `@strudel/transpiler`, `superdough`
> **Pattern used:** `repl()` from `@strudel/core` (NOT the convenience `webaudioRepl()` wrapper)

---

## Architecture overview (what we actually wire up)

```typescript
// Imports
import { repl, evalScope } from '@strudel/core';
import { initAudioOnFirstClick, initAudio, getAudioContext,
         webaudioOutput, registerSynthSounds } from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';

// Init sequence (inside an async function, triggered by user gesture)
initAudioOnFirstClick();
const ac = getAudioContext();
if (ac.state === 'suspended') await ac.resume();
await initAudio();            // boots superdough WebAudio engine + worklet
registerSynthSounds();        // registers oscillator synths in sound registry

await evalScope(              // installs Strudel globals onto globalThis
  import('@strudel/core'),
  import('@strudel/webaudio'),
  import('@strudel/mini'),
);

const strudelRepl = repl({    // creates scheduler + evaluate pipeline
  defaultOutput: webaudioOutput,
  getTime: () => ac.currentTime,
  transpiler,                 // enables mini-notation string transforms
});
strudelRepl.setCps(CPM / 60);

// To play code:
strudelRepl.evaluate(codeString);  // transpiles → evals → sets pattern → scheduler starts
```

---

## Error catalogue

### Error 1 — `transpile is not exported by @strudel/transpiler`

**Symptom:** Vite build error at import time.

**Cause:** The package exports `transpiler` (a raw string-transform function) and `evaluate`
(a chained async runner), but NOT a function named `transpile`.

**Fix:**
```typescript
// ✗ Wrong
import { transpile } from '@strudel/transpiler';

// ✓ Correct
import { transpiler } from '@strudel/transpiler';
// Pass it to repl():
repl({ transpiler, ... });
```

---

### Error 2 — `silence is not defined`

**Symptom:** Runtime `ReferenceError` inside eval'd Strudel code.

**Cause:** `silence`, `s`, `note`, `struct`, `stack`, and other Strudel pattern
functions are globals that must be explicitly installed onto `globalThis`.
When using `repl()` directly (not `webaudioRepl()`), this installation step is
skipped unless you call `evalScope()` yourself.

**Fix:** Call `evalScope` with dynamic imports of every package whose globals you need:
```typescript
await evalScope(
  import('@strudel/core'),    // silence, stack, cat, sequence, …
  import('@strudel/webaudio'),
  import('@strudel/mini'),    // m() — required by transpiler output (see Error 4)
);
```

---

### Error 3 — `Scheduler: no pattern set! call .setPattern first`

**Symptom:** Runtime error immediately after initialisation.

**Cause:** Old code called `strudelRepl.scheduler.start()` before any `evaluate()` had
been called. The scheduler requires a pattern to be set first.

**Fix:** **Never call `scheduler.start()` manually.** The `repl.evaluate()` method starts
the scheduler automatically the first time it sets a pattern. Remove any manual
`scheduler.start()` call.

```typescript
// ✗ Wrong — causes the error
strudelRepl.scheduler.start();

// ✓ Correct — evaluate() handles everything
strudelRepl.evaluate(codeString);
```

---

### Error 4 — `m is not defined`

**Symptom:** Runtime `ReferenceError` inside eval'd Strudel code.

**Cause:** The Strudel transpiler converts **every double- or single-quoted string
literal** in the code into a call to `m("...", index)` — the mini-notation parser.
For this to work at runtime, `m` must exist as a global. It is provided by
`@strudel/mini`, but only after `evalScope` loads it.

**Fix:** Include `import('@strudel/mini')` in the `evalScope` call (see Error 2 fix above).

**Key detail — what the transpiler does:**
```typescript
// Your source code:        note("c4").s("square")
// After transpiler:        note(m("c4", 0)).s(m("square", 1))
//
// So m() MUST be a global when the eval'd string runs.
```

---

### Error 5 — `k2.includes is not a function` (TypeError in `.p()`)

**Symptom:** Runtime TypeError inside superdough when patterns try to stack via `.p()`.

**Cause:** The transpiler converts ALL string literals, including the argument to `.p()`.
```typescript
// Your code:         .p("s1")
// After transpiler:  .p(m("s1", 2))   ← m() returns a Pattern object, not a string
//
// Pattern.prototype.p() expects a plain string and calls .includes("$") on it.
// Passing a Pattern object causes .includes() to fail.
```

**Fix:** Avoid string literals in `.p()` calls. Use a numeric expression that evaluates
to a string at runtime — the transpiler only transforms quoted strings, not expressions:
```typescript
// ✗ Wrong — transpiler converts "s1" to m("s1", ...)
`.p("s${this.id}")`

// ✓ Correct — no string literal; (1).toString() → "1" at runtime
`.p((${this.id}).toString())`
```

---

### Error 6 — `sound square not found! Is it loaded?`

**Symptom:** No audio output; superdough error in browser console.

**Cause:** `s("square")`, `s("sawtooth")`, `s("sine")`, etc. are oscillator-based
synthesisers that must be registered into superdough's sound registry.
`webaudioRepl()` does this automatically via an internal call to `registerSynthSounds()`.
When using `repl()` from `@strudel/core` directly, you must do it yourself.

**Fix:** Import and call `registerSynthSounds()` after `initAudio()`:
```typescript
import { initAudio, registerSynthSounds } from '@strudel/webaudio';

await initAudio();
registerSynthSounds(); // registers square, sawtooth, sine, triangle, supersaw, fm, pulse…
```

**Where this lives in the package tree:**
`superdough/synth.mjs` → re-exported by `superdough/index.mjs` → re-exported by
`@strudel/webaudio` (via `export * from "superdough"`).

---

## Loading other types of sounds — will you hit the same error?

**Short answer: yes, but for different reasons.** Strudel has three distinct sound source
types, each with its own registration requirement:

### Type 1 — Oscillator synths (what we use now)

`s("square")`, `s("sawtooth")`, `s("sine")`, `s("triangle")`,
`s("supersaw")`, `s("fm")`, `s("pulse")`, `s("user")` etc.

**Registration:** `registerSynthSounds()` — already called. ✅ No further work needed.

---

### Type 2 — Sample-based sounds (drum kits, instruments, etc.)

`s("bd")`, `s("hh")`, `s("piano")`, `s("casio")`, etc.
These are audio files loaded from a URL or a local server.

**Registration required:** You must provide a sample map — a JSON file mapping sound
names to arrays of audio file URLs:
```typescript
import { samples } from '@strudel/webaudio';

// Option A — Strudel's default sample library (hosted on GitHub)
await samples('https://strudel.cc/EmuSP12.json');

// Option B — Tidal's Dirt-Samples pack (large, loads lazily)
await samples('github:tidalcycles/Dirt-Samples/main');

// Option C — A local server (useful during development)
await samples('http://localhost:5432');

// Option D — Inline map of local files (Vite can import assets as URLs)
await samples({
  kick: ['/samples/kick.wav'],
  snare: ['/samples/snare.wav'],
});
```

**If you skip this:** `sound bd not found! Is it loaded?` — the same class of error as
Error 6 above.

**Important notes:**
- `samples()` is re-exported from `@strudel/webaudio` (via superdough).
- Audio files load lazily; the first trigger may be silent while the file fetches.
- Call `samples(...)` **after** `initAudio()` and **before** any `evaluate()` that uses
  those sounds.

---

### Type 3 — Supradough worklet samples (advanced)

`s("something").supradough()` — uses a separate `supradough` WebAudio worklet.

**Registration:** Requires a separate `doughsamples()` call and the supradough worklet
being set up. Not currently used in this project; see `@strudel/webaudio`
source for `doughsamples` / `le` export if needed.

---

## Quick-reference checklist for future agents

| Sound type | Example | What to call |
|---|---|---|
| Oscillator synths | `s("square")` | `registerSynthSounds()` after `initAudio()` |
| Remote sample pack | `s("bd")`, `s("piano")` | `await samples('URL/to/pack.json')` |
| Local sample files | `s("kick")` | `await samples({ kick: ['/kick.wav'] })` |
| Default Strudel pack | all built-in sounds | `await samples('https://strudel.cc/EmuSP12.json')` |

All of the above must happen **after** `await initAudio()` and **inside a user-gesture
callback** (e.g. a button click), because `AudioContext` requires a user interaction to
start in browsers.

---

## Full `initializeAudio()` template (copy-paste ready)

```typescript
import { repl, evalScope } from '@strudel/core';
import {
  initAudioOnFirstClick, initAudio, getAudioContext,
  webaudioOutput, registerSynthSounds, samples,
} from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';

async function initializeAudio(): Promise<void> {
  initAudioOnFirstClick();
  const ac = getAudioContext();
  if (ac.state === 'suspended') await ac.resume();

  await initAudio();
  registerSynthSounds();          // oscillator synths: square, sawtooth, …

  // Uncomment to also load a sample pack:
  // await samples('https://strudel.cc/EmuSP12.json');

  await evalScope(
    import('@strudel/core'),
    import('@strudel/webaudio'),
    import('@strudel/mini'),
  );

  const strudelRepl = repl({
    defaultOutput: webaudioOutput,
    getTime: () => ac.currentTime,
    transpiler,
  });
  strudelRepl.setCps(bpm / 60);

  // Evaluate code — starts the scheduler automatically on first call
  strudelRepl.evaluate(`note("c4").s("square").decay(0.2)`);
}
```
