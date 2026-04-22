# Progress & lessons-learned

## 2026-04-22 — Pre-baked-pattern refactor + arm-length fix (bug-fix round 1)

Five related sweeper bugs fixed as a single architectural consolidation.

**Symptoms.**
1. Default graph seeded `distance → sound.lpf` but the user expected
   `distance → sound.frequency` (pitch, not filter cutoff) — and there was
   no first-class `sound.frequency` node; only a two-port
   `sound.frequency-range` chip that silently mutated `shape.freqLow/high`.
2. Data chips emitted raw units (px, rad, counts) at varying ranges, so
   every sound chip had to know each data chip's domain.
3. `_publishSensorGlobals()` wrote `globalThis.__sw_<id>_<name>` every rAF;
   data-chip codegen emitted `signal(() => globalThis.…)` live reads.
   Inconsistent with the rest of the pipeline, which was already baked
   from `sweepTicks`.
4. **Phantom clusters past the tip.** `rebuildSweepTicks` /
   `computeSweepClusters` received `state.orbitalMaxRadius` as `maxR`, not
   `shape.size`. Shrinking the arm in the sidebar visually cropped the arm
   but ray-search kept finding clusters out to the outer orbit, leaking
   their frequencies into the audio.

**Fix — two-pass pre-baked codegen with a single source of truth.**

- All data-side chips now implement `perTickValue(shape, arm, tick, slot,
  maxR) → 0..1`. `SWEEP_CLUSTER_THRESHOLD/40`, `count/shape.k`,
  `distance/maxR`, `variance/π`. Data-side `codegen` was deleted (returns
  `''` in all cases).
- All sound-side chips own their min/max range via internal `buildSliderRow`
  UI (same chrome as the sidebar's Cluster-Count / Fineness / Arm-Length
  sliders), with a per-chip curve (exp for pitch/frequency/LPF, quadratic
  for gain, linear for effects).
- `compileGraphToStrudel` runs Pass 1 (cache shared `SweepStack`s per data
  node × arm) then Pass 2 (sound chips call `ctx.resolveInboundStack`,
  map values through their curve, emit `.freq("v0 v1 …")` / `.lpf("…")` /
  `.gain("…")` patterns). Fan-out preserved — two sound chips feeding off
  the same data chip read the same cached stack.
- `sound.frequency-range` → renamed `sound.frequency`, single `frequency`
  input port taking 0..1, internal min/max Hz sliders.
- `seedDefaultGraph` now wires `distance-to-sun → sound.frequency` and
  `cluster-count → sound.gain` — so the panel view, the Strudel textarea,
  and the audible pattern are all produced from the same NodeGraph and
  cannot diverge by construction.
- `shape.ticks` was tied to `shape.fineness`: a single sidebar slider now
  drives both visual playhead quantization and baked-pattern length. The
  legacy `ticks = 60` default was removed.
- New `sweeperMaxR(shape, state) = min(shape.size, state.orbitalMaxRadius)`
  helper in state.ts; six callsites in main.ts/controls.ts swapped to use
  it. `shape.sweepMaxR` stores the last-used `maxR` so data chips can
  normalize without reaching into `AppState`.
- `_publishSensorGlobals`, `inboundSignalExpr`, `signalRefRaw`,
  `signalRefFromEdge`, `rawRefFromEdge` all **deleted** (not quarantined).
  The generated textarea contains no `signal(` or `globalThis.__sw_`
  references for sweepers; everything is a static whitespace-separated
  Strudel pattern string.

**Verification.** 249 unit tests pass (including new `perTickValue` 0..1
contract tests, baked-pattern tests, fan-out test). Browser verification
at 1400×900 showed `uniqueFreqCount = 119` across `shape.ticks = 120`
with no `signal(` / `globalThis.__sw_` in the output, and shrinking arm
length 400→80 collapsed the audible frequency range from 159–230 Hz down
to 114–119 Hz — phantom clusters past the tip are gone.

**Lessons for next time.**

- **Prefer one pipeline, not two behind a flag.** The pre-bake path and
  the live-signal path coexisted because each previous unit only touched
  one. The ping-pong bug (see below) came from exactly this mismatch.
  When a second code path appears that could replace a first, consolidate
  rather than keep both.
- **A `maxR` that isn't the `maxR` the user sees is a time bomb.** The
  `orbitalMaxRadius` default worked when `shape.size` was cosmetic only;
  once "Arm Length" became a real UX control (Unit 2), the divergence
  became audible immediately. Single-source-of-truth field on the shape
  (`sweepMaxR`) fixes it permanently.
- **The NodeGraph is the source of truth — make it structurally impossible
  to disagree with the textarea.** The default-graph fix was a one-line
  change once we accepted that the graph IS the state. Earlier drafts
  tried to keep a separate "telemetry mirror"; the user pointed out that
  was unnecessary, and they were right.

Files touched: `src/state.ts`, `src/shapes.ts`, `src/main.ts`,
`src/controls.ts`, `src/node-editor/types.ts`, `src/node-editor/codegen.ts`,
`src/node-editor/panel.ts`, `src/node-editor/index.ts`,
`src/node-editor/nodes/data.ts`, `src/node-editor/nodes/sound-basic.ts`,
`src/node-editor/nodes/sound-effects.ts`, `src/node-editor/nodes/sweeper.ts`,
plus test files for each.

## 2026-04-22 — Ping-pong playback mode was silent + visible-only no-op

**Symptom.** Selecting "Ping-Pong" on a sweeper's `playback.mode` node had zero
effect: arm kept rotating forward monotonically, audio kept playing the 60-step
pattern forward. Spring mode likewise did nothing.

**Two overlapping root causes** — a classic "fix one, bug still shows":

1. **Editor commit path never applied side-effect nodes.** `closeEditor()` in
   `src/node-editor/panel.ts` called `compileGraphToStrudel()` (which only emits
   sound-side codegen fragments) but never called `applyPlaybackNode()`. So
   `shape.playbackMode` stayed at `'normal'` even after the user picked
   `'ping-pong'` in the editor. Fixed by iterating `activeGraph.nodes` for
   `'playback.mode'` and applying each one before the codegen step.

2. **rAF loop bypassed `stepPlayhead()` during audio playback.** `src/main.ts`
   used an AudioContext-clock phase shortcut (`phase = elapsed/cycleS % 1`) that
   always produced monotonic forward motion, so `_stepPingPong` and `_stepSpring`
   were dead code whenever audio was playing. The memory note describing sweepers
   as "rotating with CPM via stepPlayhead()" was accurate only before the clock
   shortcut landed — Unit 10 (playback modes) was never retrofitted.

**Resolution — use Strudel's native `.palindrome()` for ping-pong audio.** The
sweeper's audio is a **discrete 60-step pattern**
(`freq("100 200 ... 440").gain("...").s("sawtooth")`), not a continuous signal —
the `signal(() => globalThis.__sw_...)` path is only for *effect modulation*
when data-nodes are wired. Discrete patterns are exactly what Strudel's
`.palindrome()` is designed for, so one fragment-push in `compileGraphToStrudel`
handles the audio. Visual arm reverses via a triangle-wave phase formula
derived from the same AudioContext clock, so visual and audio stay perfectly
synced.

**Spring removed entirely.** Strudel has no critically-damped-spring primitive
(`swingBy` is rhythmic swing; `sine`/`tri` signals modulate amplitude, not
*timing* of events). Rather than ship a half-honest visual-only mode, the whole
Spring implementation was ripped out — type union, shape fields, `_stepSpring()`,
`PLAYBACK_MODES` entry, spring test blocks. Legacy configs containing `'spring'`
coerce safely back to `'normal'`.

**Lessons for next time:**

- **Side-effect nodes are invisible to codegen.** Any node whose job is to
  mutate `shape.*` (not emit Strudel fragments) MUST be applied by the commit
  path in addition to whatever live-UI handler already exists (sidebar select's
  `onChange` in our case). Codegen-side filtering (`def.side !== 'sound'`)
  won't catch them.

- **Audio-clock shortcuts have to re-declare compatibility with every new kinematic mode.**
  If a future unit adds another mode (e.g. `'retrograde'`, `'swing'`), the
  `main.ts` phase-formula branch needs an explicit case. Don't assume the
  shortcut is mode-agnostic.

- **"Discrete vs continuous" governs which Strudel primitives apply.** Before
  writing custom math, check whether the pattern is event-based (palindrome/rev
  apply) or a continuous signal (sine/tri/cosine apply). Our sweeper audio is
  event-based; custom math was unnecessary.

Files touched: `src/shapes.ts`, `src/main.ts`, `src/node-editor/nodes/playback.ts`,
`src/node-editor/codegen.ts`, `src/node-editor/panel.ts`,
`src/__tests__/node-editor-playback.test.ts`, `src/__tests__/node-editor-codegen.test.ts`,
`src/__tests__/config-snapshot.test.ts`. 242 unit tests pass.
