# TODOs

## Design: Session Summary Screen

**What:** Design a glassmorphism summary card for Co-Explore session end (after N rounds or "Finish Early"). Show top-3 configs with scores, final lock state, learning curve mini-chart, Export/Replay actions.

**Why:** After 20 rounds of careful rating, the user invested real effort. The session end is the payoff moment. A bare "session over" state wastes that investment. A summary screen rewards the user and provides a clear path to export (which produces the research artifact).

**Pros:** Completes the emotional arc. Clear export CTA increases likelihood of data capture. Provides visual evidence the GP improved over time (learning curve chart).

**Cons:** Additional UI component. Needs a mini-chart renderer (could be a simple canvas sparkline, ~30 lines).

**Context:** The "Configuration Complete" card (all-locked state) covers the edge case where the user locks everything. This TODO covers the normal session end. Both should share the same glassmorphism card pattern but with different content. The completion card has "you found it" energy; the summary card has "here's what we learned together" energy.

**Depends on:** Rating card implementation, replay mode, GP observation storage.

**Added by:** `/plan-design-review` on 2026-04-15.

## Tech Debt

### Refactor main.ts into sub-modules
**Priority:** Medium
**Added:** 2026-04-15 (eng review)
Extract main.ts (1,539 lines) into focused modules: sequencer.ts, shape-management.ts, theme.ts, tour.ts. The file is a God module where every feature adds wiring. At ~2,000 lines it becomes hard to navigate. Touching every function signature is risky, so needs thorough testing after refactor. Can be done independently of any feature work.

## V1.5 Optimizations

### Polar coordinate representation for GP position parameters
**Priority:** Medium
**Added:** 2026-04-15 (eng review, outside voice finding)
**Depends on:** V1 agent implementation complete
Convert pos_x/pos_y to polar (r, θ) in the GP's internal representation. For circles, drop θ entirely (rotational symmetry reduces dimensionality from 8 to 7). Cartesian coordinates waste GP samples on rotationally equivalent positions. Adds coordinate conversion code and changes lock UX ("lock radius" vs "lock x-position"). Accepted Cartesian + normalization for V1.

## V2

### Multi-shape scene optimization
**Priority:** Low (V2)
**Added:** 2026-04-15 (eng review, outside voice finding)
**Depends on:** V1 complete + user study validation
Extend the agent to optimize multiple shapes simultaneously for polyrhythmic texture exploration. Layering multiple shapes is the system's primary creative affordance. Dramatically increases parameter space (8 dims per shape). Requires new GP strategy (joint optimization or sequential per-shape).
