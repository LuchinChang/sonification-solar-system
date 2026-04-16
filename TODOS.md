# TODOs

## Design: Session Summary Screen

**What:** Design a glassmorphism summary card for Co-Explore session end (after N rounds or "Finish Early"). Show top-3 configs with scores, final lock state, learning curve mini-chart, Export/Replay actions.

**Why:** After 20 rounds of careful rating, the user invested real effort. The session end is the payoff moment. A bare "session over" state wastes that investment. A summary screen rewards the user and provides a clear path to export (which produces the research artifact).

**Pros:** Completes the emotional arc. Clear export CTA increases likelihood of data capture. Provides visual evidence the GP improved over time (learning curve chart).

**Cons:** Additional UI component. Needs a mini-chart renderer (could be a simple canvas sparkline, ~30 lines).

**Context:** The "Configuration Complete" card (all-locked state) covers the edge case where the user locks everything. This TODO covers the normal session end. Both should share the same glassmorphism card pattern but with different content. The completion card has "you found it" energy; the summary card has "here's what we learned together" energy.

**Depends on:** Rating card implementation, replay mode, GP observation storage.

**Added by:** `/plan-design-review` on 2026-04-15.
