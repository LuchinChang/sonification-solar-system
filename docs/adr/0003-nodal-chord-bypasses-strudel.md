# Nodal Chord synthesis bypasses Strudel; probe audio does not

## Status

accepted (2026-07-06)

## Decision

The **Nodal Chord** (the pattern selector's per-pair chord of Nodal Point
voices) is synthesised with raw WebAudio — one small oscillator graph per
nodal point (`PeriodicWave` for additive combinations; two `OscillatorNode`s
in a modulation topology for ring-mod/FM) — deliberately outside the
`@strudel/core`/`@strudel/webaudio` pipeline that Architecture Rule 3
mandates for all other audio. The boundary rule: **Strudel for probe audio,
raw WebAudio for selector-local chord audio.** The sweeper **Hold** feature
stays inside Strudel (surgical re-eval of the probe's pattern into constant
sustained voices) because a held probe must sound identical to its rotating
self, including its node-editor effect chain.

## Context

The Nodal Chord needs four things Strudel's pattern scheduler is bad at:
continuous un-snapped frequencies (the Fifths Mapping is explicitly
non-quantised), an arbitrary combination operator between two
resonance-ratio-locked partials (sum / ring-mod / free-index FM — Strudel has
`.fm` but no ring-mod or custom two-partial wavetables), sustained
organ-style envelopes, and live parameter response on an already-sounding
chord (the timbre playground retriggers/reshapes voices as knobs move).
A preview chord is also *not probe audio*: it never enters the node editor,
never bakes into `sweepTicks`, and dies with the selector — so the probe
pipeline's guarantees buy it nothing.

## Considered options

- **Everything through Strudel** — encode chord voices as one-cycle stacked
  `freq(...)` patterns. Rejected: no ring-mod/wavetable operators, envelope
  and live-knob behaviour fight the scheduler, and re-eval churn during knob
  drags contradicts the deferred-commit editor pattern.
- **Everything raw, including Hold** — rejected: a held sweeper would drop
  its Strudel effect chain (lpf/room/gain/shape) and stop sounding like
  itself.
- **Split by ownership** (chosen) — probe audio is Strudel's; selector-local
  chord audio is raw WebAudio.

## Consequences

- Two audio paths coexist permanently; a future reader will find `new
  OscillatorNode(...)` in selector code despite Rule 3 — that is deliberate,
  not drift.
- The Nodal Chord cannot be routed through node-editor effects without first
  migrating it into the probe pipeline; if chords ever need to become probes,
  that is a re-architecture, not a patch.
- Both paths share one `AudioContext` (Strudel's), so the selector chord
  respects global mute and needs no second user-gesture unlock.
