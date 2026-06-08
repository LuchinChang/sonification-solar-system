# Solar System Sonification

An interactive sonification playground: users spawn shapes whose geometric motion
against the Solar System's orbits drives Strudel audio. Every term here names a
concept a player or sonification researcher would recognise — not an implementation detail.

## Language

**Sweeper**:
A radial "hour-hand" arm anchored at the Sun whose rotation triggers a baked
discrete audio pattern; currently the only active shape type.
_Avoid_: arm, hand, hour-hand (these are visual descriptions, not the concept)

**Generator**:
The node in the editor that selects a **Sweeper**'s sound — either a reserved
**Signature Waveform** or one of the raw oscillators (Sine/Triangle/Square/Saw).

**Signature Waveform**:
A reserved, user-facing sound identity (Signature Waveform 1–4) chosen in the
**Generator**, intended to host bespoke synthesis later.
_Avoid_: oscillator, synth type — a Signature Waveform is a named slot, distinct
from the raw oscillators that also appear in the same dropdown.

## Relationships

- A **Sweeper** sounds with exactly one **Generator** selection: either a
  **Signature Waveform** (1–4) or a raw oscillator (Sine/Triangle/Square/Saw).
- The four **Signature Waveforms** are presently placeholders that all sound like
  `sine`; the raw oscillators keep their own sound. Each selection is stored as a
  stable **key** (`sig1…sig4`, `sine`, `triangle`, `square`, `sawtooth`) and
  resolved to a Strudel oscillator at codegen. When real synthesis lands, only the
  resolution changes — keys, labels, and saved sweepers are unaffected.

## Example dialogue

> **Dev:** "If 'Signature Waveform 1' and 'Sine' both sound like sine, can't I just store `sine` for both?"
> **Domain expert:** "No — they're different **Generator** selections. Store the *key* (`sig1` vs `sine`) so the dropdown remembers which the player picked and the placeholder can grow its own sound later; resolve the key to an oscillator only when generating Strudel."

## Flagged ambiguities

- "waveform" was used to mean both a **Signature Waveform** (a reserved identity)
  and a raw Strudel oscillator. Resolved: these are distinct **Generator**
  selections that coexist in one dropdown; the stored *key* is decoupled from the
  *oscillator* it currently resolves to, so several keys may map to `sine` today.
