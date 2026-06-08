# Revive discrete probes through the node-editor pipeline, not the quarantined audio model

## Status

accepted (2026-06-07)

## Decision

Circle (and later triangle/rectangle) probes are being revived as **node-editor
probes**: their perimeter↔orbit crossings are binned by angle into the existing
`sweepTicks[arm][tick][slot]` structure (`bakeDiscreteTicks`, `arm = 0`), and
their sound is produced by the same `perTickValue → SweepStack → Strudel`
pipeline the sweeper uses — with two new discrete-only nodes (`data.collision`,
`sound.rhythm`). We deliberately did **not** un-comment the quarantined
discrete-shape audio code.

## Context

When circle/triangle/rectangle were quarantined (commit `6d81d48`, 2026-04-21),
every block was wrapped in `// LEGACY:` comments with a stated policy of "revive
by un-comment." That policy is now **overridden for the audio model**: the
quarantined code implements an obsolete architecture — discrete collision events
compiled to hardcoded instrument templates (`s("bd").struct(...)`,
`note("c4 e4 g4 b4")...`) via a 256-step rhythm grid — that predates the 13-file
node editor. The node editor is now the project's only exploration surface, and
the core philosophy is that every audio mapping should be user-explorable.

## Considered options

- **Un-comment the LEGACY audio path** (the documented revival route). Fast, but
  resurrects un-explorable hardcoded mappings — second-class probes that
  contradict the "reward curiosity" principle. Rejected.
- **Integrate into the node editor** (chosen). The circle's old angle-binned
  intersection math maps exactly onto the generic `(arm, tick, slot)` interface,
  so the entire sound pipeline is reused; only the discrete *geometry*
  (`bakeDiscreteTicks`) and two nodes are new.

## Consequences

- The LEGACY geometry helpers (`getLineCircleIntersections`, the circle
  draw/hit-test/playhead cases) were revived; the LEGACY **audio** blocks
  (collision-event triggering, `generateRhythmString`'s 256-grid, the
  per-instrument templates) stay quarantined and are now effectively dead for
  the revived path.
- A discrete probe's rhythm is expressed as a Strudel `.struct()` mask that must
  chain **after** the pitch fragment (value-first); the codegen voice-builder
  enforces this with a `tailOrder` sort on sound nodes.
- Discrete-only nodes carry `appliesTo: ['circle']` so the sweeper palette and
  audio behaviour are untouched (zero regression to proven sweeper code).
