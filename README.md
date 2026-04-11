# Solar System Sonification

An interactive web application that turns planetary orbital patterns into music. Users place geometric shapes on a canvas of orbital link lines; a playhead sweeps around each shape, triggering sounds at intersection points. Built with TypeScript, HTML5 Canvas, and [Strudel](https://strudel.cc/) live coding audio.

## Getting Started

```bash
npm install
npm run dev        # Vite dev server on localhost:5173
npm run build      # Production build
npm run test       # Run all tests
npm run test:watch # Watch mode
```

## Architecture

### Module Map

| File | Lines | Responsibility |
|------|-------|----------------|
| `main.ts` | ~90 | Entry point — wires modules, animation loop |
| `state.ts` | ~190 | Centralized typed state (`AppState`), constants, theme types |
| `dom.ts` | ~110 | DOM element registry — single `resolveDomElements()` call |
| `controls.ts` | ~480 | Event handlers: mouse, keyboard, knobs, shape management |
| `renderer.ts` | ~120 | Canvas rendering: sun, orbital lines, shapes, dust particles |
| `audio.ts` | ~110 | Strudel REPL lifecycle, AudioContext management |
| `telemetry.ts` | ~130 | Strudel code generation, surgical textarea patching |
| `tour.ts` | ~210 | 11-step guided walkthrough for first-time users |
| `theme.ts` | ~25 | Dark/light theme switching |
| `shapes.ts` | ~710 | `CanvasShape` class: geometry, playhead, collisions, code gen |
| `engine.ts` | ~200 | Orbital mechanics: Kepler solver, link line computation |
| `geometry.ts` | ~75 | Pure math: line-circle intersection, ray-segment distance |
| `patterns.ts` | ~220 | Planetary pattern catalog (6 patterns) |
| `orbital-elements.ts` | ~85 | NASA JPL Keplerian element data for 8 planets |

### Data Flow

```
User action
  → controls.ts (event handlers)
    → state.ts (mutation)
      → telemetry.ts (code generation)
        → audio.ts (Strudel evaluation)
      → renderer.ts (canvas repaint)
```

## Key Algorithms

### 1. Orbital Link Lines (engine.ts)

Each pair of planets traces a spirograph-like curve. Link lines connect the two planets' positions at evenly-spaced time steps across multiple orbital periods.

- **Heliocentric mode**: Positions computed from NASA JPL Keplerian elements using a 6-step algorithm: centuries from J2000 → mean anomaly → eccentric anomaly (Newton-Raphson on Kepler's equation) → true anomaly → heliocentric ecliptic coordinates → 2D projection.
- **Geocentric mode**: Earth at center; Moon/Sun positions computed with optional eccentricity and apsidal precession.

### 2. Intersection Detection (shapes.ts)

Each shape pre-computes intersection angles with all link lines at spawn/resize/move time. The playhead sweeps `[prevAngle, currAngle]` each animation frame; cached intersections whose angle falls in that arc trigger sounds. Correctly handles the 2π → 0 wrap-around boundary.

- **Circles**: Quadratic formula on the line-circle equation (geometry.ts)
- **Triangles/Rectangles**: Parametric segment-segment intersection on each edge

### 3. Sweeper Clustering (shapes.ts)

Sweeper shapes cast a rotating ray from their center. For each ray angle:

1. Collect distances of all ray-segment hits (parametric solver in geometry.ts)
2. Sort ascending, then greedy 1D clustering with a 2px gap threshold
3. Select top-K clusters by density, re-sort by distance
4. Map to frequency (100–1000 Hz based on distance) and gain (0.6–0.9 based on density)

Pre-computed for N ticks × M arms → stored as `sweepTicks[arm][tick]` for Strudel pattern generation.

### 4. Strudel Code Generation (shapes.ts, telemetry.ts)

Each shape produces executable Strudel code:

- **Non-sweepers**: A 256-step binary rhythm grid (`1` = intersection, `~` = silence) fed to `.struct()`. Instrument-driven templates: drums → percussive hit, synths → 4-note chord arpeggio with LP filter, keys → melodic chord, bass → low register.
- **Sweepers**: Pre-computed freq/gain arrays per tick, stacked across arms and clusters.

Surgical regex patching (`@rhythm-N`, `@shape-start/end-N` markers) updates rhythm strings without disturbing user edits to the pattern lines.

## Shape Types

| Shape | Playhead | Intersection Method | Default Instrument |
|-------|----------|--------------------|--------------------|
| Circle | Dot on perimeter | Line-circle quadratic | Bass Drum (bd) |
| Triangle | Dot on edge | Segment-segment per edge | Bass Drum (bd) |
| Rectangle | Dot on edge | Segment-segment per edge | Bass Drum (bd) |
| Sweeper | Rotating ray(s) | Ray-segment distance clustering | Sine synth |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause (or skip draw animation) |
| `D` | Toggle control dock + UI panels |
| `I` | Toggle live code telemetry panel |
| `P` | Open/close pattern selector |
| `Backspace` | Delete selected shape |
| `Cmd/Ctrl+Enter` | Evaluate & sync live code |
| `Cmd/Ctrl+Scroll` | Adjust sample rate |
| `Scroll` (on shape) | Resize shape / rotate sweeper start angle |

## Patterns

| Pattern | Planets | Years | Petals | Type |
|---------|---------|-------|--------|------|
| Pentagram of Venus | Venus — Earth | 8 | 5 | Heliocentric |
| Flower of Mars | Earth — Mars | 15 | 7 | Heliocentric |
| Mercury-Venus Rosette | Mercury — Venus | 5 | 6 | Heliocentric |
| Mercury's Web | Mercury — Earth | 7 | 22 | Heliocentric |
| Jupiter's Crown | Earth — Jupiter | 12 | 11 | Heliocentric |
| Lunar Hexagon | Moon — Sun | 17.9 | 6 | Geocentric |

## Testing

**11 test suites, 144 tests** covering:

| Category | File | Tests |
|----------|------|-------|
| Geometry & Math | `geometry.test.ts` | Line-circle, ray-segment, point-segment |
| Orbital Engine | `engine.test.ts` | Line generation, clamp utility |
| Shape System | `shapes.test.ts` | Hit-testing, intersections, playhead, animations, code gen |
| Strudel Compile | `strudel-compile.test.ts` | Generated code compiles through transpiler |
| State | `state.test.ts` | Factory defaults, constant ranges, theme definitions |
| Telemetry | `telemetry.test.ts` | Code generation, surgical patching, eval status |
| Audio | `audio.test.ts` | REPL evaluation, CPS sync, null safety |
| Theme | `theme.test.ts` | Canvas color palettes per theme |
| Renderer | `renderer.test.ts` | Dust particle system initialization |
| Tour | `tour.test.ts` | Step progression, action matching, localStorage |
| Controls | `controls.test.ts` | Shape selection, deletion, cache rebuild |

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Rendering**: HTML5 Canvas 2D API
- **Audio**: Strudel (@strudel/core, @strudel/webaudio, @strudel/mini)
- **Build**: Vite
- **Tests**: Vitest
