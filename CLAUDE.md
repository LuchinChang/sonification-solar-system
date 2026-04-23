# Project: Solar System Sonification Game

### gstack
Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.
Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review,
/design-consultation, /design-shotgun, /design-html, /review, /ship, /land-and-deploy,
/canary, /benchmark, /browse, /open-gstack-browser, /qa, /qa-only, /design-review,
/setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex,
/cso, /autoplan, /pair-agent, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn.

### Commands
- `npm run dev` — Vite dev server on port 5173
- `npm test` — Vitest single run (20 suites pass, 220+ tests; 2 require `jsdom` — install if needed)
- `npm run test:watch` — Vitest in watch mode
- `npm run build` — TypeScript compile (`tsc`) then Vite bundle
- `npm run deploy` — gh-pages deploy of `dist/`

### Core Philosophy: The one and only guideline of the interface, the game, and the mappings is that they should enable and encourage users to explore more of the dataset (Solar System planet motions). Every UI choice and audio mapping should reward curiosity. This is an instantiation of the Sonification Playground as detailed in the ICAD_2026_SonificationPlayground.pdf paper.

### Architecture Rules:

1. Language: TypeScript (Strict typing to prevent runtime errors).

2. Rendering: HTML5 Canvas API. Maintain a high-performance render loop (requestAnimationFrame). Pre-calculate heavy static math (like orbital lines) where possible.

3. Audio: Use the @strudel/core and @strudel/webaudio libraries. Audio must trigger precisely based on geometric intersections on the canvas.

4. Modularity: Keep math separated from rendering and audio logic.

5. Node Editor: `src/node-editor/` is a 13-file subsystem (cables, graph state, codegen, sidebar, animations). It follows a deferred-commit pattern — cable drags mutate graph in memory; Strudel re-evals only on panel close or Ctrl+Enter, not during drag.

### Analyze if you should work in a work tree
1. Figure out if you should be working in a separate environment, if so, name the work tree properly

### Check Progress.md first before you start planning and implementing

1. This contains the previous nasty bugs, you should not make a same mistake twice

### Test the features yourself before telling me you are done

1. Run `npm test` to verify all 22 test suites pass (no pre-commit hook — this is a manual step)

#### E2E tests

2. Test the newly added features yourself first (using either Chrome extension or preview, you should click and see if there is sound, etc)

3. Only the sweeper shape is active (circle/triangle/rectangle were disabled 2026-04-21 and kept as LEGACY comments). Spawn a sweeper — no sound should play before pressing play or Cmd+Enter. Then test every sound parameter in the node editor and verify audio responds correctly.

### Maintain Progress.md

1. When you fix a serious bug, you should document the process in Progress.md

### Commit your changes at the end

1. The final step of your plan is to commit all the changes after all tests were passed

