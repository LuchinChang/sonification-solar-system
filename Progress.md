# Progress & lessons-learned

## 2026-06-07b — Circle centred on the Sun + original ring pulse revived

Two refinements to the shipped circle probe.

**Spawn centred (reverses the offset decision).** The circle now spawns at the
Sun (`new CanvasShape(sun.x, sun.y, 'circle', radius)`), radius-fanned
(`min(150 + n·60, MAX_SHAPE_SIZE)`) so multiple circles form concentric rings.
The original revival spawned *offset* because a centred circle has a constant
perimeter→Sun distance (flat pitch). We chose **rhythm-first**: at centre the
seeded Distance→Pitch is a single drone tuned by the radius (resize to retune)
while planetary motion drives the rhythm; dragging off-centre revives melodic
variation. `density`/`angleVariance` are baked constant, so distance is the only
varying pitch source — hence the drone, not a bug.

**Original expanding-ring pulse revived.** Removed the revival-era clock-hand arm
from `draw()`; un-quarantined `drawAnimations`/`triggerAt`/`stepAnimations` (coral
`#F25C54` rings, 18-frame fade). The old trigger path (`checkAndFireCollisions`)
is still quarantined, so `main.ts` now fires rings itself: when the playhead
*enters* a tick that holds a crossing, `triggerAt(c.x, c.y)` blooms a ring at the
crossing point. `drawAnimations(ctx)` was already being called in `renderer.ts`,
so only the body needed un-commenting — no new draw site.

**The one subtlety a future debugger will trip on — floor vs round.**
`bakeDiscreteTicks` bins crossings with `round((θ−startAngle)/step)` (nearest tick
*centre*), but Strudel plays step *i* over the interval `[i/TICKS, (i+1)/TICKS)`.
So the ring-trigger detector uses **`floor`** of the phase, not `round`: entering
that interval is the audible-hit instant, keeping the visual pulse locked to the
sound. It reads `playheadAngle` directly (not `prevPlayheadAngle`) so it's correct
under both the AC-clock and `stepPlayhead` fallback paths. Edge-triggered via a new
`lastRingTick` field. Stepping lives inside the `isPlaying && dt>0` guard, so pause
is a clean freeze-frame (dot + rings halt, resume continues the fade).

## 2026-06-07 — Discrete probes (circle) revived via the node editor

Brought back the **circle** as a discrete geometric probe, integrated into the
node-editor pipeline rather than by un-commenting the quarantined audio model
(see [ADR 0001](docs/adr/0001-discrete-probes-via-node-editor.md) and
[CONTEXT.md](CONTEXT.md)). The circle reuses `_toSweeperCode` + `sweepTicks` +
`perTickValue`; the only new geometry is `bakeDiscreteTicks` (crossings binned by
angle into `sweepTicks[0][tick][slot]`, distance measured to the **Sun**, since
distance-to-centre on a circle is the constant radius). New nodes:
`data.collision` + `sound.rhythm`.

**Strudel `.struct()` ordering gotcha (validated by a headless spike).** A
rhythm is a `.struct("1 ~ ~ 1 …")` mask. `queryArc` showed that
`note(...).struct(gate)` and rest-baked `note("c3 ~ ~ e3")` produce *identical*
events — struct samples the value pattern at the gate's true positions. **But
order matters:** `struct(gate).note(values)` (struct first) leaks the gate into
the hap value (`{value:1, note:"c3"}`); only value-first stays clean (`"c3"`).
So `sound.rhythm` carries `tailOrder: 100` and the codegen voice-builder
stable-sorts sound fragments so `.struct()` always chains *after* `.note()`/
`.freq()`. Reordering sound fragments is safe — each reads its own cached data
stack, never another sound node's output.

**Two bugs only live testing caught** (unit tests passed throughout):
1. The `E` hotkey opened the editor only for `type === 'sweeper'`, so circles
   couldn't be edited via keyboard — broadened to any probe.
2. The circle dock button reused the `.sweeper-spawn-btn` style class, which is
   also the sweeper spawn handler's selector → one click spawned a circle *and*
   a sweeper. Fixed by skipping `data-shape` buttons in the sweeper handler.

**Lesson.** When a new feature can be expressed through an existing universal
interface (`perTickValue → SweepStack`), do that instead of building a parallel
pipeline — the whole sound stack, ping-pong, and ordering logic come for free.
And always dogfood UI wiring: the spawn/hotkey bugs were invisible to the type
checker and the unit suite.

Dev-server `base` is now conditional (`command === 'build' ? '/sonification-solar-system/' : '/'`)
so the preview proxy doesn't 302 on `/`.

## 2026-06-06b — Scallop loops via jittered strobe (NOT dense plotting)

To match Hartmut's reference more closely (woven "scallop" loops on the hexagon
edges), the first attempt plotted the Moon **densely** in the co-rotating
Sun-Earth-View frame. **It produced a circle, not a hexagon** — verified by
rendering.

**Why dense fails.** The Moon hits apogee once per anomalistic month, and over
44 yr that happens at *every* angle → the dense curve touches the outer radius
everywhere → the envelope is a full circle. The six corners exist *only* because
the 27.275-day strobe **aliases** apogee onto six angles. Sampling finely
destroys the very aliasing that makes the hexagon.

**The fix — jittered strobe.** Keep the 27.275-day strobe (so the hexagon
survives) but offset each Sun-Earth-View time by a small periodic amount:
`t = n·viewDays + jitterDays·sin(2π·t/jitterPeriodDays)`. The offset nudges the
Moon's longitude by more than the ~0.6° gap between consecutive views, so the
polyline crosses itself into small loops, while the radius (hence the six-fold)
is essentially unchanged. Empirically tuned `MOON_VIEW_JITTER_DAYS = 0.45`,
`MOON_VIEW_JITTER_PERIOD_DAYS = 109.1` (≈ 4 views) reproduces the reference's
woven edge. Segment count stays ~600, so the sweeper audio "follows the
scallops" with no perf change. `calculateMoonHexagonLines` gained
`jitterDays`/`jitterPeriodDays` params (default 0 = clean hexagon, used by tests).

**Lesson.** When a figure is a *stroboscopic/aliased* artifact, "add detail by
sampling finer" is exactly backwards — it erases the artifact. Add detail by
perturbing the sample *times*, not by adding samples.

## 2026-06-06 — Moon-Earth lunar hexagon (replaces Lunar Hexagon)

Replaced the chord-based `lunar-hexagon` pattern with `moon-earth` (`kind:
'moon-hexagon'`), reproducing the lunar hexagon from Hartmut Warm's *Signature
of the Celestial Spheres*. New engine fns in `src/engine.ts`:
`calculateMoonHexagonLines` + `calculateMoonEclipses`.

### Gotcha 1 — a dense inertial trace is NOT a hexagon; the strobe is everything

**Symptom.** First implementation traced the Moon's precessing ellipse densely
(every sample) → a smeared ring/flower, not a hexagon.

**Root cause.** The hexagon only exists in the **stroboscopic frame**: sample
the Moon's geocentric position once per *Sun-Earth-View* = the synodic
solar-rotation period **27.275 days**, then connect consecutive samples. Per
sample the longitude regresses ≈0.62° (beat vs 27.322 d sidereal month) while
the distance phase regresses ≈3.65° (beat vs 27.555 d anomalistic month), so
distance completes ≈6 cycles per longitude turn → six lobes. `rmin/rmax ≈
0.896` (perigee/apogee), matching the reference's 363k/405k km.

**Lesson.** The sample interval *is* the algorithm. Don't increase resolution to
"smooth" a strobe figure — that destroys it.

### Gotcha 2 — eclipse markers, not all syzygies

True conjunctions (every ~14.8 d) plotted at their real positions fill the whole
annulus (the Sun points everywhere over 44 yr) and bury the hexagon. The
reference's sparse dots are **eclipses**: a syzygy occurring near a lunar node.
`calculateMoonEclipses` adds the node cycle (incl 5.145°, nodal regression
18.6 yr) and keeps only syzygies with |ecliptic latitude| < 0.9° → ~2.8/yr
(solar=New, lunar=Full), drawn as gold/red dots on the hexagon.

### Gotcha 3 (process) — edit inside the worktree, not the main checkout

The Explore agent reported main-repo absolute paths; edits initially landed in
the main checkout while the dev server + `vitest` ran against the worktree, so
"passing tests" were testing unmodified code. Fix: `git -C main diff -- <files>
| git -C worktree apply`, then revert main. **Lesson:** when in a worktree, all
edit paths must be under the worktree root; verify with `git status` in the
worktree before trusting a green test run.

### Verification note

Headless preview can't satisfy the AudioContext gate (overlay stays up) and ran
multiple page mounts, making screenshots unreliable. Verified instead via 272
passing unit tests + a `vite-node` render of the real engine to PNG (hexagon +
123 eclipses over 43.9 yr ≈ 2.8/yr). Live sweeper *audio* over the new geometry
was not verifiable headless.

## 2026-04-22 — Voice fan-out, slot-density gain, orphan-chip skip (bug-fix round 3)

Five UX/semantic bugs on the graph-based sweeper pipeline, discovered after
round 2 shipped the default-seeded graph to users. All five traced back to
assumptions baked into round 1/2 that turned out to be wrong against
the real Earth/Venus/Mars link-line geometry.

### Bug 1 — Gain pinned to 1.0

**Symptom.** `data.cluster-count → sound.gain` produced a flat
`.gain("1.000 1.000 …")` pattern. The user heard a drone at full volume.

**Root cause.** `clusterCountDef.perTickValue` normalized `group.length / shape.k`.
With default `k=4` and a busy scene, `_clustersAtAngle` always fills the
top-k slice → `group.length === 4` at every tick → normalized = 1.0 → gain = 1.0.
The normalization hid its own floor.

**Fix.** Re-purpose `data.cluster-count` as **per-slot cluster density**.
`perTickValue(shape, arm, tick, slot)` now reads the cluster at that slot
and returns `density / 20` (density = how many link-lines contributed to
that cluster; cap of 20 matches the legacy gain curve). Empty slots → 0.
Real per-tick variation: in the default scene each voice's gain stack
spans ~0.04..0.81 with 11–13 unique values. Flat drone gone.

**Lesson.** A normalization where `numerator ≤ denominator` *by construction*
eventually pegs to 1. Plans need to simulate the normalization against the
actual data distribution, not just prove the formula clamps to `[0, 1]`.
E2E caught this — unit tests didn't, because synthetic cross-lines always
produced a busy scene.

### Bug 2 — Only one voice per arm

**Symptom.** The user expected 4 stacked `.freq(…).gain(…)` patterns with
the default `k=4`, but the graph pipeline collapsed every arm to a single
voice.

**Root cause.** Round 1's `compileGraphToStrudel` iterated `sweepCount`
voices, ignoring `k`. The `slot` param on data chips was derived from
`dataNode.params.slot` (always 0 by default). The legacy `_toSweeperCode`
did fan out `sweepCount × k`, but that was lost in the round-1 rewrite.

**Fix.** Fan out codegen over `(arm × slot)`: `buildVoiceForArmSlot(…, slot)`
passes the slot index directly to `perTickValue`, keyed into the stack
cache as `(dataNodeId, arm, slot)`. `defaultParams.slot` removed from
distance/angle-variance chips — slot is now purely a codegen iteration
axis. With defaults that's 4 parallel voices, each reading a different
cluster slot, stacked via `.stack()`. Verified in preview: voice 0 at
21..340 Hz (near Sun), voice 3 at 366..2030 Hz (far from Sun) — natural
harmonic stacking across the sweep.

**Lesson.** The "fan-out" axis was conflated between a data-chip param
(per-node state) and a codegen iteration (per-voice). Separating them
was the right move — the param version only supported one slot per chip;
the iteration version gives every voice its own slot for free.

### Bug 3 — Orphan `.freq(…)` / `.note(…)` after cable swap

**Symptom.** Disconnecting `Frequency` and reconnecting a new `Pitch`
chip left BOTH `.freq(…)` AND `.note(…)` in the textarea. Cable swap
didn't truly swap.

**Root cause.** `buildVoiceForArm` called every sound chip's `codegen`
regardless of whether it was wired. Each sound chip's codegen had an
`if (!edge) return '.freq(<fallback>)'` branch — so an unwired chip
still emitted its fragment. Two sound chips = two fragments.

**Fix.** Skip the chip in codegen when `def.inputs.length > 0 && inbound.length === 0`.
Chips with declared input ports but no wires are treated as orphans and
contribute nothing. Chips without declared inputs (pure param emitters)
still run. Orphan chips stay in the graph so users can reconnect them.

**Lesson.** "Graph contains node" ≠ "node emits code". The deferred-commit
editor model treats the graph as truth, but truth about structure, not
about audible fragments. The skip makes the semantics match user intent:
"disconnected = silent".

### Bug 4 — Default chips all overlapping

**Symptom.** Four chips all at `(0, 0)` after a freshly spawned sweeper's
editor opened. The panel's `renderAllNodes` fell back to a diagonal grid,
but the layout wasn't predictable.

**Fix.** Explicit 2×2 positions in `seedDefaultGraph`:
Distance-to-Sun top-left, Frequency right of it; Cluster-Count bottom-left,
Gain right of it. `COL_LEFT=264, COL_RIGHT=480, ROW_TOP=48, ROW_BOTTOM=186`.

**Lesson.** The sidebar sweeper-controls panel floats over the first ~250px
of the canvas. Original plan coords (`COL_LEFT=48`) placed data chips
entirely behind the sidebar — unit tests passed (the coords were exact)
but E2E screenshot exposed the occlusion. Shifted COL_LEFT to 264 to
clear the sidebar. Planning-phase coords shouldn't trust the plan
without seeing the rendered result.

### Bug 5 — Frequency range too narrow

**Fix.** `sound.frequency.defaultParams` moved from `{min: 100, max: 1000}`
to `{min: 20, max: 4400}`. Slider bounds stayed at 20..20000 Hz so users
can still push further. Exp curve keeps pitch perception smooth across
the wider span.

---

## 2026-04-22 — Voice structure + default-edge rendering (bug-fix round 2)

Two bugs surfaced after the round-1 pre-bake refactor landed, both caused by
details of the pipeline that only became important once the default graph
was actively seeding/rendering cables and the compiled textarea was the
canonical sound source.

### Bug A — Generator changes barely altered the sound

**Symptom.** Switching the Generator chip (sine → sawtooth → triangle) from
the sidebar dropdown did *almost nothing* to the audible sound. The textarea
showed the new instrument name, Strudel reported `✓ synced`, but the tone
didn't obviously shift.

**Root cause — Strudel pattern structure inheritance.** When patterns combine,
the **leftmost pattern creator owns the time-structure**. My voice shape was:

```js
s("sawtooth").freq("v0 v1 … v119").gain("g0 g1 … g119")
```

`s("sawtooth")` alone is one event per cycle spanning (0, 1). `.freq("…")`
gets 120 events per cycle from its mini-notation, but Strudel collapses
them into the single `s()` span — all 120 freq values fire simultaneously
as a sustained chord. Verified by querying the pattern:

```js
g.s('sawtooth').freq(m('100 200 300 400')).queryArc(0, 1)
// → 4 events, ALL at (b:0, e:1) — a simultaneous 4-note chord
g.freq(m('100 200 300 400')).s('sawtooth').queryArc(0, 1)
// → events at (0, .25), (.25, .5), (.5, .75), (.75, 1) — sequential
```

The legacy `shape.toStrudelCode()` path avoided this by ending the chain
with `.s("…")` — the freq() pattern's structure is what wins. The
pre-baked codegen didn't match that shape.

**Fix.** Rebuild the voice with `.s(instrument)` at the TAIL. `buildVoiceForArm`
now joins fragments (which all start with `.`), strips the first dot so the
leading fragment is a standalone pattern creator, and appends `.s("<instrument>")`:

```ts
const body = fragments.join('');                  // ".freq(…).gain(…)"
if (body === '') return `s("${instrument}")`;    // drone fallback
const head = body.startsWith('.') ? body.slice(1) : body;
return `${head}.s("${instrument}")`;              // "freq(…).gain(…).s(…)"
```

**Secondary fix — backticks for multi-line mini-notation.** `bakePattern`
chunks 120 values into 8-per-line rows joined by `\n    ` for readability.
That's fine inside Strudel's mini-notation, but a JS SyntaxError (`unterminated
string constant`) when emitted inside `"…"`. Swapped every sound-chip wrapper
to template literals — `.freq(\`…\`)` / `.gain(\`…\`)` / `.lpf(\`…\`)` / etc.
Matches `toStrudelCode`'s pre-existing convention.

### Bug B — Default-seeded cables weren't visible in the editor

**Symptom.** First open of the node editor showed four chips (Frequency,
Gain, Distance to Sun, Cluster Count) but **no cables between them** — yet
the generated Strudel code reflected the wiring and produced audio. Users
asked whether the chips were actually connected.

**Root cause.** `panel.ts` `renderAllNodes()` paints `.ne-node` cards with
port dots, but never paints the SVG paths. `cables.ts` `renderEdge()` was
only called inside `endDrag` (user-initiated drag commit) — the seeded/
hydrated branch never materialized existing edges. The edges lived in
`activeGraph.edges` (which is why codegen worked), just not in the DOM.

**Fix.**
- `reflowAllEdges` now *reconciles* the DOM against `graph.edges`: existing
  paths re-anchor, orphaned paths prune (unchanged), and edges in the graph
  without a matching DOM path get `renderEdge()`-ed.
- `openEditor` emits a `graphChanged` event right after `renderAllNodes()`,
  which cables.ts's handler picks up and runs reconciliation against the
  seeded/hydrated graph.
- `onGraphChanged` runs synchronously instead of via `scheduleReflow`'s rAF.
  Structural changes (edges appearing/disappearing) want immediate paint; the
  rAF batching only ever mattered for per-frame drag reflows (`cableReflow`
  still batches).

### Verification

- 253 unit tests pass (+4 skipped); new regressions:
  - `node-editor-codegen.test.ts` — voice structure Bug 1 regression: voice
    must NOT begin with `s("…")`; must end with `.s("<instrument>")`; empty-
    fragments voice falls back to bare `s("…")`.
  - `node-editor-cables.test.ts` — cables Bug 2 regression: pre-existing
    graph edges materialize SVG paths when `graphChanged` fires.
- Browser verification at 1400×900:
  - Seeded editor shows 4 chips + 2 cables visible (`edgeCount: 2`, screenshot
    captured).
  - Changing generator in sidebar → close panel → textarea block starts with
    `freq(\`…\`).gain(\`…\`).s("sawtooth")`, comment header updates to
    `s="sawtooth"`, Strudel status stays `✓ synced` during playback.
  - Direct `queryArc(0, 1)` on the fixed pattern shape produces sequential
    event spans (confirming the sound-structure bug is gone).

### Lessons for next time

- **Don't assume commutativity of Strudel's pattern combinators.** `s("…")`
  and `.s("…")` look interchangeable but produce wildly different time
  structures. When in doubt, `p.queryArc(0, 1)` returns the actual event
  spans — use it as a debugger, not just a test tool.

- **The data model is the source of truth, but the DOM is what the user
  sees.** When a refactor changes who *creates* objects (here: seed/hydrate
  vs. user-drag), remember that the rendering pipeline probably only hooks
  one of those paths. Seed/hydrate producing an identical graph that
  *looks* disconnected is a classic "graph and view diverged" bug.

- **JS template literals > double-quoted strings for multi-line DSLs.**
  Any baked output that crosses line boundaries should be wrapped in
  backticks. Strudel's mini-notation treats whitespace identically either
  way, but JS only forgives newlines inside template literals.

Files touched: `src/node-editor/codegen.ts`, `src/node-editor/cables.ts`,
`src/node-editor/panel.ts`, `src/node-editor/nodes/sound-basic.ts`,
`src/node-editor/nodes/sound-effects.ts`, plus test updates in
`node-editor-codegen.test.ts`, `node-editor-cables.test.ts`,
`node-editor-sound-basic.test.ts`, `node-editor-sound-effects.test.ts`.

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
