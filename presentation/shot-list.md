# Walkthrough Recording — Shot List

## Production strategy
**Edited cuts, system audio only.** Light editing — trim pattern draw-ins,
parameter-drag dead time, and verbal flubs. Never cut over unbroken music.
LC narrates **live** during the talk; recordings are silent except for app audio.

## Pre-recording checklist
- [ ] Mac System Audio output set to internal speakers or known good sink.
- [ ] App running locally (`npm run dev`) at `http://localhost:5173`.
- [ ] Browser zoom 100%, window sized to ~1280×800 (matches slide aspect).
- [ ] Hide cursor unless explicitly needed for an action.
- [ ] Use QuickTime "New Screen Recording" with system audio enabled
      (System Settings → Privacy & Security → Screen Recording grants).
- [ ] Record a single ~10s test clip and verify audio captures cleanly.

## Takes

### Take 1 — Phase 0 (causal model) → ~18s of edited video

**Setup**
- Pattern: **Earth–Moon**
- Sweeper, single arm
- `k = 1`
- `CPM = 5`
- `SR = 200`
- Instrument: **sine**

**Actions**
1. Pattern is already drawn in (don't record the draw-in).
2. Sweeper spawned with the parameters above; play paused.
3. Hit record → press Space (play) → let arm rotate ~1.5 revolutions (~18s).
4. Stop record.

**What the audience hears:** a single tone fires per tick as the arm crosses each
spike. Pitch varies by radial distance.

---

### Take 2 — Phase 1 (ear training) → ~20s of edited video

**Setup:** continues from Take 1's end state.

**Actions**
1. Hit record while audio is still playing.
2. Bump `k = 1 → 2` via the sidebar slider. Let it run ~6s.
3. Bump `k = 2 → 3`. Let it run ~6s.
4. (Optional) bump `k = 3 → 4`. Let it run ~6s.
5. Stop record.

**Edit:** combine Take 1 + Take 2 into a single `assets/phase0-1.mp4`. Cut over
the slider-drag moments if the drag is more than ~1s.

---

### Take 3 — Phase 2a (chord progression) → ~25s of edited video

**Setup**
- Pattern: **Earth–Jupiter**
- Sweeper, single arm
- `k = 3`
- `CPM = 5`
- `SR = 35`
- Instrument: **sine** or **piano** (match Table 1, paper)

**Actions**
1. Pattern fully drawn in, sweeper armed, play paused.
2. Hit record → press Space → play ~25s of audio.
3. Stop record.

**What the audience hears:** sparse, harmonically related frequency clusters →
chord progression with a major-key feel.

---

### Take 4 — Phase 2b (dense regime) → ~25s of edited video

**Setup:** continues from Take 3 — same Earth–Jupiter pattern.

**Actions**
1. Hit record.
2. Jump parameters: `SR = 35 → 805`, `k = 3 → 30`, `CPM = 5 → 16`. (Use sidebar;
   single drag per parameter is fine.)
3. Let it run ~25s.
4. Stop record.

**Edit:** combine Take 3 + Take 4 into a single `assets/phase2.mp4`. Cut over
the parameter-jump moment so the regime change feels immediate.

---

### Take 5 — Phase 3 (visual/audio cameo) → ~16s of edited video

**Setup**
- Pattern: **Earth–Moon**
- Sweeper, single arm
- `k = 3`
- `CPM = 16`
- `SR = 805` (initially)
- Instrument: percussive (e.g. **drums** family)

**Actions**
1. Hit record → play ~7s with `SR = 805` (punchy, spike-aligned hits).
2. Pause audio.
3. Change `SR = 805 → 795`.
4. Play ~7s (smooth, even-spread wash).
5. Stop record.

**Edit:** save as `assets/phase3.mp4`. After the second clip ends, the deck
fades in a side-by-side still of the two visuals (handled in slide CSS).

---

### Phase 4 fallback recording → `assets/phase4-fallback.mp4`

**Purpose:** insurance for the live demo on Slide 8. Identical to the live
actions, captured ahead of time.

**Setup**
- Pattern: **Earth–Moon** (or whatever you pre-stage for live)
- Sweeper, default mapping audible

**Actions**
1. Open the node editor.
2. Show the existing graph (synth + freq + gain).
3. Swap synth from sawtooth → square (or comparable change).
4. Drop a low-pass-filter data node onto the canvas.
5. Wire it to the synth's filter input.
6. Press `Ctrl+Enter`.
7. Let the new sound play ~10s.

Save as `assets/phase4-fallback.mp4`. ~60s total.

## Editing notes
- **Tools:** iMovie (free), DaVinci Resolve (free), QuickTime + clip joining.
- **Format:** export as `.mp4`, H.264, 1280×800 or close, 30fps.
- **No audio normalization needed** — the app's gain envelopes are already
  designed to sit at sane levels.
- **No transitions between takes** when concatenating. Hard cuts are fine and
  reinforce the "this happened in real time" feel.

## Asset map (final)
- `assets/phase0-1.mp4` ← Take 1 + Take 2
- `assets/phase2.mp4`   ← Take 3 + Take 4
- `assets/phase3.mp4`   ← Take 5
- `assets/phase4-fallback.mp4` ← Phase 4 fallback
