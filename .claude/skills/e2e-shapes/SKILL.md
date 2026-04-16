---
name: e2e-shapes
description: E2E test all four shape types per CLAUDE.md checklist
disable-model-invocation: true
---

Use the browser (Playwright or /browse) to test each shape type sequentially against the running dev server.

For each shape type — **circle**, **sweeper**, **triangle**, **rectangle** — run through this checklist:

1. **Spawn** the shape using the Sonic Foundry dock button
2. **Verify silence** — no sound should play before pressing play or Cmd+Enter
3. **Press play** (Cmd+Enter or the play button in Orbital Engine controls)
4. **Verify sound triggers** — confirm audio plays when the playhead intersects the shape
5. **Test sound parameters** — adjust every available sound parameter for this shape and verify each one audibly changes the output
6. **Delete the shape** and confirm it is removed from the canvas

Report pass/fail for each step of each shape. If any step fails, stop and diagnose before continuing.
