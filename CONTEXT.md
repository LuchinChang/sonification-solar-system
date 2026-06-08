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
The node in the editor that selects which **Signature Waveform** a **Sweeper** sounds with.

**Signature Waveform**:
A named, user-facing sound identity (Signature Waveform 1–4) chosen in the **Generator**.
_Avoid_: oscillator, synth type, waveform name (sine/sawtooth/…) — those are the
current implementation, not the concept the user picks.

## Relationships

- A **Sweeper** sounds with exactly one **Signature Waveform**, chosen via its **Generator**.
- A **Signature Waveform** is presently a placeholder: each one aliases a raw Strudel
  oscillator (1=sine, 2=sawtooth, 3=square, 4=triangle), to be replaced with bespoke
  synthesis later. The user-facing identity is stable across that future change.

## Example dialogue

> **Dev:** "If I rename the dropdown options to 'Signature Waveform 1', should I rename the stored value too?"
> **Domain expert:** "No — the **Signature Waveform** is the identity the player sees; the oscillator behind it is implementation. Strudel still needs the real oscillator name, so the label changes but the value stays `sine`."

## Flagged ambiguities

- "waveform" was used to mean both the user-facing **Signature Waveform** and the
  underlying Strudel oscillator string. Resolved: these are distinct — the label is
  decoupled from the value so the oscillator can be swapped without changing the identity.
