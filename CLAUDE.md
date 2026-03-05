# Project: Solar System Sonification Game

### Core Philosophy: The one and only guideline of the interface, the game, and the mappings is that they should enable and encourage users to explore more of the dataset (Solar System planet motions). Every UI choice and audio mapping should reward curiosity.

### Architecture Rules:

1. Language: TypeScript (Strict typing to prevent runtime errors).

2. Rendering: HTML5 Canvas API. Maintain a high-performance render loop (requestAnimationFrame). Pre-calculate heavy static math (like orbital lines) where possible.

3. Audio: Use the @strudel/core and @strudel/webaudio libraries. Audio must trigger precisely based on geometric intersections on the canvas.

4. Modularity: Keep math separated from rendering and audio logic.