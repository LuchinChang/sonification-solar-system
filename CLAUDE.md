# Project: Solar System Sonification Game

### gstack
Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.
Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review,
/design-consultation, /design-shotgun, /design-html, /review, /ship, /land-and-deploy,
/canary, /benchmark, /browse, /open-gstack-browser, /qa, /qa-only, /design-review,
/setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex,
/cso, /autoplan, /pair-agent, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn.

### Core Philosophy: The one and only guideline of the interface, the game, and the mappings is that they should enable and encourage users to explore more of the dataset (Solar System planet motions). Every UI choice and audio mapping should reward curiosity. This is an instantiation of the Sonification PLayground as detailed in the ICAD_2026_SonificationPlayground.pdf paper. You should make sure you have 

### Architecture Rules:

1. Language: TypeScript (Strict typing to prevent runtime errors).

2. Rendering: HTML5 Canvas API. Maintain a high-performance render loop (requestAnimationFrame). Pre-calculate heavy static math (like orbital lines) where possible.

3. Audio: Use the @strudel/core and @strudel/webaudio libraries. Audio must trigger precisely based on geometric intersections on the canvas.

4. Modularity: Keep math separated from rendering and audio logic.

### Analyze if you should work in a work tree
1. Figure out if you should be working in a separate environment, if so, name the work tree properly

### Check Progress.md first before you start planning and implementing

1. This contains the previous nasty bugs, you should not make a same mistake twice

### Test the features yourself before telling me you are done

1. Do a test commit to test yourself with the pre-commit tests

#### E2E tests

2. Test the newly added features yourself first (using either Chrome extension or preview, you should cliuck and see if there is sound, etc)

3. Test a circle, a sweeper, a triangle, a square sequentially. When you spawn the shape, there shouldn't be any sound before you press play, or cmd+enter. You then should test every sound parameters available to the shape, and make sure everything works as epxected

### Maintain Progress.md

1. When you fix a serious bug, you should document the process in Progress.md

### Commit your changes at the end

1. The final step of your plan is to commit all the changes after all tests were passed

