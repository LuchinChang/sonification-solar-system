# Progress & lessons-learned

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
