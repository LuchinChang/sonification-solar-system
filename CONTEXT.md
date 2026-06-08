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

## Example dialogue

> **Dev:** "When the circle's playhead reaches a tick with no crossing, what plays?"
> **Domain expert:** "Nothing — that tick is a rest in the rhythm. The struct mask is `~` there. Pitch only matters at ticks that *have* a crossing, and it comes from that crossing's distance to the Sun."
> **Dev:** "And a sweeper at the same tick?"
> **Domain expert:** "Different model — a sweeper has no perimeter, so no crossings and no rests. It reads distance clusters along its ray and always sounds; quiet only when a cluster is far or sparse."

## Flagged ambiguities

- "shape" was used to mean both *any live probe* and *the quarantined geometry family* — resolved: **Probe** is the live concept; "shape" is the broader, looser word.
- "distance" on a circle is ambiguous: distance-from-centre is the constant radius, distance-to-**Sun** is the musical signal — the **Distance-to-Sun** data node always means the latter. A circle now spawns **centred on the Sun**, where every crossing is exactly `radius` from the Sun, so the seeded Distance→Pitch is intentionally a single **radius-tunable drone** (resize to retune); dragging the ring off-centre revives per-crossing pitch variation. Multiple circles fan by **radius** into concentric rings.
- "collision" historically meant the old playhead-crossing audio trigger (removed); it now means a **Crossing** datum feeding the **Rhythm** node. See [ADR 0001](docs/adr/0001-discrete-probes-via-node-editor.md).
