# Patterns are hybrid: a curated catalogue over a computed any-pair space

## Status

accepted (2026-07-05)

## Decision

The pattern selector lets the user pick any inner/outer planet pair, and every
valid pair produces a playable **Computed Pattern** generated from real orbital
constants (semi-major axes, periods; petal count derived from the period
ratio). Pairs that match one of the hand-authored catalogue entries resolve to
that **Curated Pattern** instead, keeping its authored name, tuned cycle
length (`simYears`), and caption script. The two flavours share one
`PlanetaryPattern` shape; curation is an overlay, not a separate type.

## Context

The original selector exposed exactly 8 hand-tuned patterns. The core
philosophy (ICAD Sonification Playground) is that every surface should reward
curiosity across the *whole* dataset — capping exploration at 8 of the 28
possible planet pairs contradicted that. But the authored caption scripts are
genuinely valuable narration and cannot be machine-generated at the same
quality.

## Considered options

- **Curated-only** — the two-column picker as pure navigation over the 8
  presets, invalid combos greyed out. Smallest scope; rejected for capping
  exploration.
- **Fully generated** — drop the catalogue, compute everything including
  captions from templates. Uniform; rejected because it throws away the
  hand-authored narratives for the flagship patterns.
- **Hybrid** (chosen) — computed space with curated overlay.

## Consequences

- `patterns.ts` permanently carries two provenances: authored entries and a
  generator. A future reader will find some pairs with rich captions and
  others with generic/absent ones — that asymmetry is deliberate.
- Computed defaults (duration, petals, caption fallback) must be derivable
  from orbital constants alone; anything that can't be derived must be
  optional in the pattern shape.
- Adding a new curated pattern is now *tuning* (override a computed pair),
  never *enabling* (the pair already works).
