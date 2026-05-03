# LLM Evidence-Capture Prompt — Slide 2

## Purpose
Slide 2's third beat — *"Naive AI doesn't fix this"* — needs a real screenshot of an
LLM's one-shot sonification attempt. The argument is **unsteerability, not
incompetence**: even when the LLM's output is reasonable, the user has no knobs to
adjust afterward. That's the gap the playground fills.

## Rules of engagement
- **Run the prompt once.** No re-rolls, no cherry-picking, no prompt iteration.
- Use a SOTA model the audience would consider fair (Claude Opus 4.7, GPT-5,
  Gemini 2.5 Pro — anything contemporary).
- Capture the *first* response verbatim.
- If the model produces something that actually works musically, that's *fine* —
  the slide's argument doesn't depend on it failing.

## The prompt

```
I want to sonify the geometric pattern formed by line segments that
connect Earth and Jupiter at regular time samples over their ~11-year
orbital resonance, with both planets orbiting the Sun. Together the
line segments trace an 11-petal crown shape in 2D.

Please produce a complete sonification of this pattern that I can run
in the browser. The output should:
- map geometric properties of the pattern to audio dimensions
- produce something musically interesting, not just a single beep
- be self-contained code I can paste and run

Give me the code, and briefly explain your mapping choices.
```

## Capture checklist

1. **Screenshot** the chat response: crop to show the first paragraph of mapping
   rationale + the first ~10 lines of code. Save as `assets/llm-output.png`.
2. **Optional 5-second audio clip** of the LLM's code running in the browser, if
   it runs cleanly. Save as `assets/llm-output.mp3`. (If the code doesn't run,
   that's not the point — don't dwell on it during the talk.)
3. **One annotation line** on the slide (already wired into `slides.html`):
   *"One mapping. No knobs. Where do I go from here?"*

## Q&A defense (if asked "did you try a better prompt?")

> "The issue isn't the prompt. It's that the output is a one-shot mapping with
> no exploration affordances. Even if I give the LLM a better prompt, I still
> get *one* mapping back. The playground's contribution is that it gives the
> LLM — and the human — a structured space to iterate within. That's
> Section 5.1 of the paper."

Don't get drawn into prompt-engineering arguments. The structural critique is
your high ground.
