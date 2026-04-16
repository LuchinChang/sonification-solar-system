# Design System: Solar System Sonification

Theme: **Martian Dusk** (dark) / **Daylight** (light)
Font: JetBrains Mono (300, 400, 500, 600)
Rendering: HTML5 Canvas + glassmorphism UI overlays

---

## Color Palette

### Dark Theme (default)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-canvas` | `#120F0E` | Canvas background, lowest layer |
| `--bg-html` | `#080604` | HTML body behind canvas |
| `--color-sun` | `#FFA030` | Sun glyph at canvas center |
| `--color-lines` | `rgba(194,118,46,0.35)` | Orbital geometry lines |
| `--color-dots` | `#E8472C` | Intersection dots (coral/vermilion) |

### Accent Palette

| Token | Hex | Role |
|-------|-----|------|
| `--accent-copper` | `#C87A2E` | Interactive borders, structural accents, knob needles |
| `--accent-amber` | `#E8A050` | Active/highlighted states, knob dots, readout values |
| `--accent-coral` | `#E8472C` | Playing state, trigger animations, warnings |

Rule: copper for structure, amber for emphasis, coral for action/alerts.

### Sound Category Colors

| Token | Hex | Category |
|-------|-----|----------|
| `--cat-perc` | `#E8472C` | Percussion (coral) |
| `--cat-bass` | `#C87A2E` | Bass (copper) |
| `--cat-pad` | `#E8A050` | Pad (amber) |

### Light Theme (`[data-theme="light"]`)

Swaps to creamy off-white background (`#EDE9E0`), dark warm text, vermilion accents (`#E03C31`). All `--glass-*` tokens invert to light frosted glass. See `src/style.css` lines 59-88 for full mapping.

---

## Typography Scale

| Element | Size | Weight | Spacing | Transform | Token |
|---------|------|--------|---------|-----------|-------|
| Knob readout value | 18px | 300 | -0.02em | — | `--accent-amber` |
| Panel title | 9.5px | 600 | 0.17em | uppercase | `--text-secondary` |
| Body text | 13px | 400 | — | — | `--text-primary` |
| Code editor | 11.5px | 400 | — | — | `--text-primary` |
| Hints / captions | 9px | 400 | 0.07em | — | `--text-dim` |
| Button labels | 9.5px | 500 | 0.09em | uppercase | `--text-secondary` |
| Step counters | 9px | 600 | 0.17em | uppercase | `--text-dim` |
| Kbd shortcuts | 9px | 400 | — | — | `--text-dim` |

Text color hierarchy: `--text-primary` (warm cream, 0.93) > `--text-secondary` (muted copper, 0.75) > `--text-dim` (deep brown, 0.58).

---

## Glassmorphism Surfaces

All floating UI panels share this recipe:

```css
background: var(--glass-bg);           /* rgba(20,13,11,0.78) */
backdrop-filter: var(--glass-blur);    /* blur(20px) saturate(160%) */
border: 1px solid var(--glass-border); /* rgba(194,118,46,0.22) */
border-radius: 14px-18px;             /* 14px panels, 18px cards */
box-shadow: 0 6px 32px rgba(0,0,0,0.60), 0 1px 0 rgba(255,200,120,0.04) inset;
```

Hover: `border-color: var(--glass-border-hover)` (copper at 0.55 opacity).

---

## Component Patterns

### Rotary Knob
- SVG 56x56 viewBox: track circle (r=22), needle group (line + dot), center hub (r=7)
- Needle rotates via `transform: rotate(Xdeg)` on `transform-origin: 50% 50%`
- Range: continuous (Sample Rate, CPM) or discrete with detent snap (ratings 1-5)
- Discrete detent angles for 1-5: -135deg, -67.5deg, 0deg, 67.5deg, 135deg
- Below knob: numeric readout (18px amber) + unit label (8.5px dim uppercase)

### Pill Button (`.instrument-pill`, `.mode-option`)
- Padding: 4px 11px, min-width 36px
- Border-radius: 6px (pills) or 999px (mode toggle)
- Active: `--accent-amber` background at 0.22, amber border, amber text, subtle glow

### Glassmorphism Card (`.pattern-band`)
- Centered overlay with backdrop blur
- Inner padding: 32px 40px, border-radius 20px
- Content: title + grid/controls + hint text

### Toast Notification (`.pattern-toast`)
- Fixed top-center (top: 48px), auto-fade after 2.5s
- Glass background, 10px border-radius
- For transient feedback: mode changes, interventions, unlocks

### Lock Icon (new for Co-Explore)
- 14px padlock SVG, inline with control rows
- Unlocked: `--text-dim`, minimal visual weight
- Locked: `--accent-amber`, `box-shadow: 0 0 6px rgba(232,160,80,0.20)`
- Semantics: `role="switch"`, `aria-pressed`

---

## Motion

| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `--dur-fast` | 150ms | `--ease-out-quart` | Hover states, button feedback |
| `--dur-base` | 240ms | `--ease-out-quart` | Panel transitions, border changes |
| `--dur-slow` | 320ms | `--ease-out-quart` | Slide-in panels |
| Flash | 380ms | ease-out | Telemetry block flash (`.telem-flash`) |
| Global flash | 450ms | ease-out | Ctrl+Enter viewport ring |
| Caption fade | 500ms | ease | Draw animation captions |

Easing: `cubic-bezier(0.25, 1, 0.5, 1)` for all structural animations.

---

## Canvas Rendering Z-Order

1. Background fill (`--bg-canvas`)
2. Heatmap overlay (when Co-Explore active, 0.20 opacity, amber palette)
3. Orbital geometry lines (`--color-lines`)
4. Intersection dots (`--color-dots`)
5. Shapes (circle, triangle, rectangle, sweeper) with playhead indicators
6. Shape selection highlight + contextual lock bar
7. UI overlays (dock, panels, toasts, rating card)

---

## Spacing Conventions

- Dock section padding: 14px 22px 12px
- Control gap within sections: 10px
- Glass card inner padding: 11px 13px (compact) to 32px 40px (full cards)
- Button gap in rows: 4px (tight, instrument pills) to 10px (sequencer controls)
- Vertical separator: 1px gradient (transparent → glass-border → transparent)

---

## Accessibility Baseline

- All interactive elements: `tabindex="0"`, keyboard operable
- Sliders/knobs: `role="slider"`, `aria-valuemin/max/now`, `aria-label`
- Toggles: `role="switch"`, `aria-pressed`
- State changes: `aria-live="polite"` regions for round transitions, mode changes
- Focus visible: 2px `--accent-copper` outline, 3px offset
- Touch targets: minimum 34px (play/pause, theme toggle)
- Color contrast: all body text meets WCAG AA (4.5:1+) against glass backgrounds
