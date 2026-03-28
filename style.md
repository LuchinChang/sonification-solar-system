# Solar System Sonification — Design System

## Theme: "Martian Dusk" (dark) / "Daylight" (light)

A high-end glassmorphism aesthetic inspired by spacecraft instrument panels and warm desert twilight. Every surface feels like frosted glass over a dark, warm void. The canvas is alive — a sun breathes at the center, dust motes drift through copper-tinted space, and geometric shapes pulse with sound.

---

## Color Palette

### Dark Theme (Martian Dusk)
| Token              | Value                         | Usage                        |
|--------------------|-------------------------------|------------------------------|
| `--bg-canvas`      | `#120F0E`                     | Canvas / deep background     |
| `--bg-html`        | `#080604`                     | HTML body, true black        |
| `--color-sun`      | `#FFA030`                     | Sun core, warm gold          |
| `--accent-copper`  | `#C87A2E`                     | Primary accent, borders      |
| `--accent-amber`   | `#E8A050`                     | Highlights, active states    |
| `--accent-coral`   | `#E8472C`                     | Triggers, percussion, alerts |
| `--text-primary`   | `rgba(235, 210, 180, 0.93)`   | Body text, warm parchment    |
| `--text-secondary` | `rgba(175, 138, 95, 0.75)`    | Labels, hints                |
| `--text-dim`       | `rgba(120, 88, 55, 0.58)`     | Tertiary, nearly invisible   |

### Light Theme (Daylight)
| Token              | Value                         | Usage                         |
|--------------------|-------------------------------|-------------------------------|
| `--bg-html`        | `#EDE9E0`                     | Creamy off-white background   |
| `--accent-copper`  | `#E03C31`                     | Vermilion replaces copper     |
| `--text-primary`   | `rgba(35, 18, 6, 0.92)`       | Dark warm brown text          |
| Glass surfaces     | `rgba(252, 250, 246, 0.88)`   | Light frosted panels          |

### Sound Category Colors (canvas accents)
| Category   | Color     | Hex       |
|------------|-----------|-----------|
| Percussion | Coral     | `#E8472C` |
| Synths     | Copper    | `#C87A2E` |
| Keys       | Amber     | `#E8A050` |
| Sweeper    | Teal      | `#2DD4BF` |

---

## Glassmorphism

Every floating panel shares the same glass recipe:
- **Background:** `rgba(20, 13, 11, 0.78)` (dark) / `rgba(252, 250, 246, 0.88)` (light)
- **Backdrop filter:** `blur(20px) saturate(160%)`
- **Border:** 1px solid `rgba(194, 118, 46, 0.22)`, brightens to `0.55` on hover
- **Shadow:** deep `rgba(0,0,0,0.60)` drop + faint warm inset glow
- **Border radius:** 14–18px for panels, 12px for tiles, 6px for pills, 999px for toggles

---

## Typography

- **Font:** JetBrains Mono (weights 300–600)
- **Body:** 13px base, antialiased
- **Labels:** 9–9.5px, `600` weight, `0.17em` letter-spacing, uppercase
- **Values:** 18px, `300` weight, negative tracking (`-0.02em`)
- **Code:** 11.5px, `1.65` line height, `tab-size: 2`

---

## Motion

| Token             | Value                              | Usage                    |
|-------------------|------------------------------------|--------------------------|
| `--dur-fast`      | `150ms`                            | Hover, press             |
| `--dur-base`      | `240ms`                            | Panel transitions        |
| `--dur-slow`      | `320ms`                            | Slide-in panels          |
| `--ease-out-quart`| `cubic-bezier(0.25, 1, 0.5, 1)`   | Smooth deceleration      |

### Interaction Patterns
- **Hover lift:** `translateY(-3px)` + glow shadow
- **Active press:** `scale(0.93)` snap-back
- **Flash feedback:** coral/green pulse on collision/evaluation
- **Panel slide:** `translateX` with quart easing

### Ambient Motion (canvas)
- **Sun breathing:** radial glow pulses sinusoidally (~4s period, +/- 8px)
- **Dust particles:** ~40 warm-toned motes drift slowly, brighter near the sun
- **Trigger rings:** expanding coral rings at collision points, 380ms fade

---

## Canvas Visual Language

- **Sun:** radial gradient glow (3 stops) + solid 10px core
- **Orbital lines:** 1px copper strokes connecting Earth-Venus sample points
- **Shapes:** stroke-only outlines (1.5px, 2.5px selected), color-coded by instrument
- **Intersection dots:** 2.5px radius, filled with shape accent color
- **Playhead:** rotating marker along shape perimeter
- **Sweeper arms:** violet (`#C084FC`) → teal (`#2DD4BF`) radial lines from sun

---

## Component Patterns

### Bottom Dock
Centered glassmorphism bar, two sections separated by a gradient hairline. Left: shape spawner tiles. Right: rotary knobs + sequencer controls. Toggleable with `D` key (slides down 14px + fades).

### Rotary Knobs
SVG-based, 64x64px. Track ring + rotating needle group + center hub. Drag vertically to adjust. Readout below: large number + small unit label.

### Shape Tiles
74px wide glassmorphism buttons with SVG icon + uppercase label. Hover: copper border + glow + lift. Active: scale down.

### Instrument Pills
Compact pill buttons (6px radius). Grouped by category with hairline separators. Active state: amber glow ring.

### Telemetry Panel
Full-height right-side slide-in. Vertical `{ }` tab handle always visible. Contains live code textarea + eval status badge + Ctrl+Enter hint footer.

---

## Signature

A subtle "LC" monogram is rendered in the bottom-left corner of the canvas — the artist's mark on a living instrument.
