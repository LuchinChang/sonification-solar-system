# Presentation — Sonification Playground (CS 8803 SRD Final)

Self-contained deck for the 10-minute final talk. HTML + reveal.js, no build step.

## Files

```
presentation/
├── slides.html              ← the deck (single file, reveal.js via CDN)
├── slides.pdf               ← exported via ?print-pdf
├── README.md                ← this file
├── prompt.md                ← LLM evidence-capture prompt (Slide 2)
├── shot-list.md             ← recording script for Slides 5–7
└── assets/
    ├── figure1.png          ← paper Fig. 1 screenshot (Slide 4 — optional)
    ├── llm-output.png       ← LLM screenshot (Slide 2)
    ├── phase0-1.mp4         ← Take 1+2 edit (Slide 5)
    ├── phase2.mp4           ← Take 3+4 edit (Slide 6)
    ├── phase3.mp4           ← Take 5 edit (Slide 7)
    └── phase4-fallback.mp4  ← live-demo failure backup (Slide 8)
```

The HTML deck renders even when assets are missing — videos show empty boxes,
the LLM placeholder shows hatching with the annotation. Drop assets in as you
produce them.

## How to present

1. Open `slides.html` in **Chrome** (Safari has occasional fragment-animation
   bugs in reveal.js 5.x).
2. Press `F` to enter fullscreen.
3. Arrow keys or `Space` to advance. `S` opens the speaker-notes window.
4. Slide 4 advances in 4 builds — press `Space` four times before going to
   Slide 5.
5. Slide 8 is your live-demo backdrop. Switch to the app window via Mission
   Control (or Cmd+Tab); switch back to reveal when done.

## How to export to PDF

1. Open `slides.html?print-pdf` in Chrome.
2. `Cmd+P` (Print).
3. Destination: **Save as PDF**.
4. Layout: **Landscape**. Paper size: **Letter** (or 1280×800 custom if
   available). Margins: **None**. Background graphics: **ON**.
5. Save as `presentation/slides.pdf`.

Embedded `<video>` tags become poster frames in the PDF — that's expected. The
PDF is the archival deliverable; the live talk uses `slides.html`.

## Speaker notes per slide (timing budget)

| # | Slide | Budget |
|---|---|---|
| 1 | Title | 15s |
| 2 | Motivation | 90s |
| 3 | Contributions | 30s |
| 4 | The Playground (4 builds) | 90s |
| 5 | Walkthrough Phase 0+1 | 75s |
| 6 | Walkthrough Phase 2 | 90s |
| 7 | Walkthrough Phase 3 | 20s |
| 8 | Live: Node editor | 60s |
| 9 | Tech stack | 30s |
| 10 | Future work | 60s |
| 11 | Closing | 30s |
| | **Total** | **9:30** |

Leaves 30s buffer in a 10-minute window.

## Pre-talk rehearsal checklist

- [ ] All 5 video assets sit in `assets/`.
- [ ] LLM screenshot in `assets/llm-output.png`.
- [ ] (Optional) `assets/figure1.png` from the ICAD paper if you want to
      replace the inline ASCII recreation of Fig. 1 with the original figure.
- [ ] Test full run on the **presentation laptop** with the **venue's audio
      output** before the talk. Strudel's first-gesture AudioContext unlock is
      the live-demo failure mode — rehearse it.
- [ ] Time a full dry run with stopwatch: target 9:30–10:00.
- [ ] Have `phase4-fallback.mp4` ready to switch to if the live demo breaks.
