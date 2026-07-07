# Solar System Sonification

A browser instrument where user-placed shapes intersect a field of planetary
"link lines" and turn those intersections into live-coded Strudel audio. This
glossary defines the domain vocabulary so code, comments, and conversation stay
aligned.

## Language

### Probes

**Geometric Probe** (or just **Probe**):
A user-placed shape whose intersection with the link-line field drives sound.
_Avoid_: "shape" when you mean specifically a probe — every live shape is a probe, but the word "shape" also covers quarantined types.

**Sweeper**:
A probe shaped as a rotating ray cast outward from a pivot; reads intersections as distance-ordered clusters (a continuous pitch/gain contour).
_Avoid_: "hand", "arm" (an arm is one ray of a multi-arm sweeper, not the whole probe).

**Discrete Probe**:
A probe with a closed perimeter (currently only the **Circle**) whose perimeter↔orbit crossings form a rhythm. Triangle and rectangle are quarantined, not live.
_Avoid_: "shape probe", "polygon".

**Playhead**:
The moving read position of a probe — a rotating ray for a sweeper, an angular dot traversing the perimeter for a circle. One full revolution = one Strudel cycle.
_Avoid_: "cursor", "needle".

**Probe colour**:
Every live probe is assigned a distinct accent colour from a fixed palette, so no two probes on the canvas share a colour (you identify a probe by its colour). The probe's outline, tick-dots, the sweeper's arm, and the circle's crossing-pulse rings are all drawn in that colour. The circle's position **dot** is the one exception — it stays white for contrast against its own colored perimeter.

### Sound selection

**Generator**:
The node in the editor that selects a probe's sound — either a reserved **Signature Waveform** or one of the raw oscillators (Sine/Triangle/Square/Saw).

**Signature Waveform**:
A reserved, user-facing sound identity (Signature Waveform 1–4) chosen in the **Generator**, intended to host bespoke synthesis later.
_Avoid_: "oscillator", "synth type" — a Signature Waveform is a named slot, distinct from the raw oscillators that also appear in the same dropdown.

### Patterns

**Pattern** (or **Planetary Pattern**):
The geometric figure traced by link lines between two orbiting bodies over time — the dataset a session explores. Selected before probing; selecting a pattern rebuilds the field.

**Curated Pattern**:
A pattern with hand-authored identity — a name, a tuned cycle length, and a caption script narrating its reveal.

**Computed Pattern**:
A pattern generated on demand from the orbital constants of a user-chosen planet pair, with derived defaults in place of authored ones. Any pair not matching a curated pattern yields a computed one.

**Inner Planet / Outer Planet (of a pair)**:
The pair member with the smaller orbit (shorter period) is the pattern's inner planet; the other is its outer planet. This is *relative to the pair* — in Venus-Earth, Earth is the outer planet.
_Avoid_: "inner planets" meaning the inner solar system (Mercury–Mars); the pair-relative sense is the canonical one here.

**Preview**:
The fast, disposable drawing of a pattern shown inside the selector while browsing: the figure draws once, then holds completed. Redrawn when the chosen pair changes. A preview never touches the field or the user's probes.
_Avoid_: calling the preview "the animation" — that word is reserved for the Reveal. Historical: previews used to loop; they now draw once and hold.

**Nodal Chord**:
The simultaneous sounding of a pattern's dominant ring of Nodal Points — one sustained voice per symmetry lobe (the resonance difference |m−k| predicts the voice count), each pitched by the Fifths Mapping and breathing visually while it sounds.
_Avoid_: "node chord", "the chord" without context once probes can also hold chords.

**Reveal**:
The one-time educational drawing of a newly applied pattern on the main canvas, in two phases: a slow **guided phase** where the planet bodies visibly stamp each link line, then an accelerated **completion phase** where the figure finishes and the planets recede.
_Avoid_: "draw animation" (legacy name for the linear lines-only version).

**Nodal Point**:
A stationary point of the pattern figure — where consecutive link lines intersect and that intersection momentarily stops moving (a point on the envelope of the link-line family). Detected as a local maximum of **Nodality**. The visually bright "knots" of a pattern.
_Avoid_: "node" — that word is reserved for node-editor graph nodes (data/sound nodes).

**Nodality**:
The stationarity measure of the running link-line intersection: closer to 1 the less the intersection point moved since the previous sample (`1/(1+Δ)`). Local maxima of nodality mark Nodal Points.

**Fifths Mapping**:
The continuous angle→pitch rule for Nodal Points: a point's polar angle around the Sun sets its pitch, stepping a perfect fifth per 30° of angle, wrapped into a single octave. Frequency is computed continuously from the angle — never snapped to the nearest semitone.
_Avoid_: "circle of fifths quantization" — nothing is quantized; nearby angles differ by cents.

### Sound state

**Held (probe)**:
A sweeper frozen at its current playhead angle while all of that tick's voices sustain continuously through the probe's own effect chain — a chord frozen out of the rotation. Toggled per probe; other probes keep playing. Uses the probe's own baked pitch mapping (the Fifths Mapping is exclusive to Nodal Chords).
_Avoid_: conflating with **Paused** (global, stops time) or **Muted** (silences everything).

**Muted**:
Sound output silenced while the engine keeps running — playheads move, patterns schedule, volume is zero. Reversible instantly at any time.
_Avoid_: conflating with **Paused**, which stops playback time itself rather than silencing it.

### The field

**Link Line** (or **Orbital Line**):
One chord of the planetary geometry — a straight segment the engine samples from planet motions. The whole set is the field a probe reads.
_Avoid_: "orbit" (an orbit is a planet's path; a link line is a sampled chord between positions).

**Crossing** (or **Collision**):
A point where a discrete probe's perimeter meets a link line. The defining event of a discrete probe; absence of a crossing at a playhead position is a rest.
_Avoid_: "hit", "intersection" when speaking about discrete probes specifically (reserve "intersection" for the raw geometry).

### Baked audio model

**Tick**:
One of `shape.ticks` quantized playhead positions around a full revolution (angular bins). The Strudel pattern has one step per tick.

**Slot**:
The intra-tick index `0..k-1` distinguishing simultaneous readings at one tick — distance-ordered clusters for a sweeper, simultaneous crossings for a circle. Each slot becomes one stacked voice.

**SweepTicks**:
The pre-baked `sweepTicks[arm][tick][slot]` structure (arrays of cluster records) both probe kinds populate and the node editor reads. A circle is `arm = 0` with crossings binned by angle.

**SweepStack**:
A node-editor data node's baked `0..1` value array, one entry per tick, produced by `perTickValue(shape, arm, tick, slot, maxR)`. Sound nodes map it into their own range.

**Rhythm**:
For a discrete probe, the `.struct("1 ~ ~ 1 …")` mask derived from per-tick crossings — `1` fires the voice, `~` is a rest.

## Relationships

- A **Probe** reads many **Link Lines** and writes one Strudel block.
- A **Sweeper** produces distance **Clusters**; a **Discrete Probe** produces **Crossings**.
- Both bake into **SweepTicks**, indexed by **Tick** × **Slot**.
- A node-editor **Data node** turns SweepTicks into a **SweepStack**; a **Sound node** turns a SweepStack into Strudel (a pitch contour, a gain envelope, or a **Rhythm** mask).
- A **Discrete Probe**'s default graph wires **Collision → Rhythm** and **Distance-to-Sun → Pitch**.
- A **Probe** sounds with exactly one **Generator** selection: either a **Signature Waveform** (1–4) or a raw oscillator (Sine/Triangle/Square/Saw). The four Signature Waveforms are presently placeholders that all sound like `sine`; the raw oscillators keep their own sound. Each selection is stored as a stable **key** (`sig1…sig4`, `sine`, `triangle`, `square`, `sawtooth`) and resolved to a Strudel oscillator at codegen — so when real synthesis lands, only the resolution changes; keys, labels, and saved probes are unaffected.

## Example dialogue

> **Dev:** "When the circle's playhead reaches a tick with no crossing, what plays?"
> **Domain expert:** "Nothing — that tick is a rest in the rhythm. The struct mask is `~` there. Pitch only matters at ticks that *have* a crossing, and it comes from that crossing's distance to the Sun."
> **Dev:** "And a sweeper at the same tick?"
> **Domain expert:** "Different model — a sweeper has no perimeter, so no crossings and no rests. It reads distance clusters along its ray and always sounds; quiet only when a cluster is far or sparse."

> **Dev:** "If 'Signature Waveform 1' and 'Sine' both sound like sine, can't I just store `sine` for both?"
> **Domain expert:** "No — they're different **Generator** selections. Store the *key* (`sig1` vs `sine`) so the dropdown remembers which the player picked and the placeholder can grow its own sound later; resolve the key to an oscillator only when generating Strudel."

## Flagged ambiguities

- "shape" was used to mean both *any live probe* and *the quarantined geometry family* — resolved: **Probe** is the live concept; "shape" is the broader, looser word.
- "distance" on a circle is ambiguous: distance-from-centre is the constant radius, distance-to-**Sun** is the musical signal — the **Distance-to-Sun** data node always means the latter. A circle now spawns **centred on the Sun**, where every crossing is exactly `radius` from the Sun, so the seeded Distance→Pitch is intentionally a single **radius-tunable drone** (resize to retune); dragging the ring off-centre revives per-crossing pitch variation. Multiple circles fan by **radius** into concentric rings.
- "collision" historically meant the old playhead-crossing audio trigger (removed); it now means a **Crossing** datum feeding the **Rhythm** node. See [ADR 0001](docs/adr/0001-discrete-probes-via-node-editor.md).
- "waveform" was used to mean both a **Signature Waveform** (a reserved identity) and a raw Strudel oscillator. Resolved: these are distinct **Generator** selections that coexist in one dropdown; the stored *key* is decoupled from the *oscillator* it currently resolves to, so several keys may map to `sine` today.
