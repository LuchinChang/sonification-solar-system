# 2-Week Implementation Plan: LLM Generator + Preference Learning Critic

**Project:** Solar System Sonification — Actor-Critic AI Pipeline
**Timeline:** March 20 – April 2, 2026 (12 working days × 1.5 hrs = 18 hrs total)
**Schedule:** Daily 1.5 hrs, Sundays off (Mar 22, Mar 29)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   Sonification Interface                │
│  (Canvas + Strudel live-code textarea — already built)  │
└────────────┬──────────────────────────┬─────────────────┘
             │ geometric state          │ user picks A or B
             ▼                          ▼
┌────────────────────────┐   ┌────────────────────────────┐
│   ACTOR (Claude API)   │   │  PREFERENCE LOGGER (JSON)  │
│ Generates 2 candidate  │   │  Stores (stateₜ, codeA,    │
│ Strudel code blocks    │   │   codeB, winner) tuples    │
│ from current shape +   │   │                            │
│ intersection geometry  │   └────────────┬───────────────┘
└────────────────────────┘                │ training data
                                          ▼
                              ┌──────────────────────────┐
                              │  CRITIC (PyTorch)        │
                              │  Bradley-Terry reward    │
                              │  model → scalar score    │
                              │  per (state, code) pair  │
                              └──────────────────────────┘
```

**Data flow at inference time (after critic is trained):**
Actor generates N candidates → Critic ranks them → top-ranked pattern plays automatically.

---

## Week 1 — LLM Generator (Actor) + A/B Comparison UI

### Day 1 · Fri Mar 20 — Claude API scaffold + prompt design

**Goal:** Call Claude from the browser and get back a valid Strudel code string.

1. **Install the Anthropic SDK** — Since the sonification app is a Vite+TS browser app, you can't call the Claude API directly from the browser (CORS + secret exposure). Set up a tiny **proxy server**:
   - Create `server/` folder at project root.
   - `npm init -y && npm install @anthropic-ai/sdk express cors dotenv`
   - Build a single POST endpoint `POST /generate` that forwards the request body to Claude and returns the completion.
   - Store your API key in `server/.env` (add to `.gitignore`).

2. **Design the system prompt** — This is the most important piece. Draft it in `server/prompts/system.txt`. It should teach Claude:
   - What Strudel mini-notation is (core syntax: `note`, `s()`, `sound()`, `.freq()`, `.gain()`, `.struct()`, `stack()`, `cat()`).
   - The instrument palette your interface supports (`bd`, `sd`, `hh`, `cp`, `superpiano`, `gm_acoustic_bass`, `sawtooth`, `sine`, `triangle`, `square`, `fm`).
   - That it must output **only** valid Strudel code — no markdown, no explanation.
   - An example of the geometric context it will receive (see Day 2).

3. **Test manually** — Use `curl` to hit your proxy, pass a dummy geometric context, verify Claude returns parseable Strudel code.

**Deliverable:** A running Express proxy with a `/generate` endpoint that returns Strudel code.

---

### Day 2 · Sat Mar 21 — Geometric context serializer + generation service

**Goal:** The interface can serialize its current state and send it to Claude.

1. **Build `src/llm-context.ts`** — A function `serializeGeometricContext()` that extracts:
   - Number of shapes, their types, positions, sizes.
   - For each shape: its `cachedIntersections` count, rhythm density, current instrument.
   - Global state: `SAMPLE_RATE`, `CPM`, number of `linkLines`.
   - The *current* Strudel code from `telemetryTextarea.value` (so Claude can riff on it).
   - Keep this compact — under 800 tokens. Claude needs room for output.

2. **Build `src/llm-service.ts`** — A thin client module:
   ```typescript
   export async function generateStrudelCode(context: string): Promise<string>
   ```
   - POSTs to your proxy at `http://localhost:3001/generate`.
   - Passes the serialized context as the user message.
   - Returns the raw Strudel code string.
   - Handles errors gracefully (network, malformed output).

3. **Wire a test button** — Add a temporary "Generate" button to the UI. On click, call `generateStrudelCode()`, log the result to console.

**Deliverable:** Clicking "Generate" logs a Claude-authored Strudel pattern to the console.

---

### Day 3 · Mon Mar 23 — A/B comparison UI (layout + state machine)

**Goal:** Build the UI for presenting two candidates side-by-side and collecting a preference.

1. **Design the A/B panel** — Add a new overlay/modal in `index.html`:
   - Two columns: **Pattern A** (left) and **Pattern B** (right).
   - Each column has: a play/pause button, the Strudel code displayed (read-only textarea or `<pre>`), and a **"Pick This"** button.
   - A "Generate New Pair" button at the top.
   - A "Skip" button if neither is good.

2. **Build `src/ab-session.ts`** — State machine for one A/B round:
   ```
   IDLE → GENERATING → PREVIEWING → PICKED → IDLE
   ```
   - `GENERATING`: Fires two parallel `generateStrudelCode()` calls (or one call requesting two variations — experiment with what works better).
   - `PREVIEWING`: Both patterns are loaded. User can play each one.
   - `PICKED`: User chose A or B. Log the preference (Day 6 builds the full logger).

3. **Audio preview plumbing** — The tricky part. You need to play pattern A *or* B through Strudel without clobbering the main sequencer:
   - Option A (simpler): Reuse the existing `strudelRepl` — when previewing A, evaluate code A; when previewing B, evaluate code B. Only one plays at a time.
   - Option B (better UX): Create a second `repl()` instance for preview. Check if Strudel supports multiple repls sharing one AudioContext.
   - Start with Option A — it's reliable and within scope.

**Deliverable:** The A/B panel opens, shows two code blocks, and play buttons switch between them.

---

### Day 4 · Tue Mar 24 — Wire generation into A/B flow

**Goal:** End-to-end: click "Generate" → Claude produces two patterns → user plays each → picks one.

1. **Connect the state machine to Claude** — In `GENERATING` state:
   - Call `serializeGeometricContext()`.
   - Fire two `generateStrudelCode()` calls with slightly different temperature or a "give me variation A / variation B" suffix.
   - Handle the race: show a loading spinner, wait for both to resolve.

2. **Evaluate and play patterns** — In `PREVIEWING`:
   - Playing A calls `strudelRepl.evaluate(codeA)` + `strudelRepl.start()`.
   - Playing B calls `strudelRepl.evaluate(codeB)` + `strudelRepl.start()`.
   - Stopping either calls `strudelRepl.stop()`.

3. **"Pick This" flow** — When the user picks one:
   - Copy the winning code into `telemetryTextarea.value`.
   - Optionally auto-evaluate so the main sequencer picks it up.
   - Log `{ context, codeA, codeB, winner: 'A' | 'B', timestamp }` to a local array for now.

4. **Edge cases** — What if Claude returns invalid Strudel code?
   - Wrap `strudelRepl.evaluate()` in try/catch.
   - Show a red "Syntax error" badge on the broken pattern.
   - Let the user still pick the other one or regenerate.

**Deliverable:** Full A/B loop works. User can generate, listen, and pick.

---

### Day 5 · Wed Mar 25 — Prompt iteration + generation quality

**Goal:** Make Claude's Strudel output actually sound good and relevant to the geometry.

1. **Prompt engineering session** — Spend the bulk of today here:
   - Run 10+ generation cycles. Listen to every output.
   - Identify failure modes: invalid syntax, boring patterns, ignoring the geometry.
   - Iterate the system prompt. Add few-shot examples of good Strudel code from patterns you've manually authored in the interface.
   - Consider adding the rhythm string (from `generateRhythmString()`) to the context so Claude can reference the actual intersection timing.

2. **Constrained generation** — If Claude keeps producing invalid code:
   - Add a validation step: try `eval()`-ing the returned code in a sandboxed Strudel context before showing it to the user.
   - Retry once on failure (with the error message appended to the prompt).

3. **Style guidance** — Add to the prompt:
   - "Match the density of the rhythm string — if there are 20 intersections, the pattern should feel busy; if there are 3, it should be sparse."
   - "Use the instrument already assigned to the shape unless you have a strong musical reason to change it."

**Deliverable:** Claude reliably produces valid, musically-relevant Strudel patterns 80%+ of the time.

---

### Day 6 · Thu Mar 26 — Preference data pipeline

**Goal:** Every A/B pick is persisted in a structured format ready for training.

1. **Define the preference schema** — Create `src/preference-types.ts`:
   ```typescript
   interface PreferencePair {
     id: string;                    // UUID
     timestamp: number;
     geometricContext: {
       shapes: { type: string; x: number; y: number; size: number; instrument: string; intersectionCount: number }[];
       sampleRate: number;
       cpm: number;
     };
     codeA: string;                 // full Strudel code
     codeB: string;
     winner: 'A' | 'B' | 'skip';
   }
   ```

2. **Build `src/preference-logger.ts`**:
   - Maintains an in-memory array of `PreferencePair`.
   - On each pick, pushes a new entry.
   - **Export to JSON** — A "Download Preferences" button in the A/B panel that triggers `JSON.stringify()` → Blob → `URL.createObjectURL()` → `<a download>`.
   - Also persists to `localStorage` as a backup so data survives page refreshes.

3. **Test the pipeline** — Do 5+ A/B rounds. Download the JSON. Inspect it. Make sure the geometric context captures enough signal for the critic to learn from.

**Deliverable:** A `.json` file with 5+ preference pairs, downloadable from the UI.

---

## Week 2 — Preference Critic (Reward Model) + Integration

### Day 7 · Fri Mar 27 — PyTorch project setup + feature engineering

**Goal:** A Python training environment that can ingest your preference JSON.

1. **Create `critic/` folder** at project root:
   ```
   critic/
   ├── requirements.txt    (torch, numpy, transformers or tiktoken for tokenizing)
   ├── data/               (drop preference JSONs here)
   ├── model.py            (reward model definition)
   ├── train.py            (training loop)
   └── serve.py            (inference endpoint for the browser)
   ```

2. **Feature engineering** — Decide how to represent `(state, code)` as a fixed-size vector. Two approaches:
   - **Simple (start here):** Hand-craft features from the geometric context (shape count, avg intersection count, CPM, sample rate) + code features (line count, number of `stack()`/`cat()` calls, instrument token counts, rhythm density). Target: ~30-50 features.
   - **Learned (stretch):** Tokenize the Strudel code with a small tokenizer, embed with a learned embedding layer, concat with geometric features.

3. **Build `data_loader.py`** — Reads the JSON, produces training triples: `(features_A, features_B, label)` where label = 1 if A won, 0 if B won.

**Deliverable:** `python data_loader.py` prints feature vectors and labels from your preference JSON.

---

### Day 8 · Sat Mar 28 — Bradley-Terry reward model

**Goal:** A small PyTorch model that predicts a scalar reward for a `(state, code)` pair.

1. **Model architecture** (`model.py`):
   ```python
   class RewardModel(nn.Module):
       def __init__(self, input_dim):
           super().__init__()
           self.net = nn.Sequential(
               nn.Linear(input_dim, 128),
               nn.ReLU(),
               nn.Dropout(0.2),
               nn.Linear(128, 64),
               nn.ReLU(),
               nn.Linear(64, 1)   # scalar reward
           )
       def forward(self, x):
           return self.net(x)
   ```

2. **Bradley-Terry loss** — The classic pairwise preference loss (same formulation as DPO's foundation):
   ```python
   def bt_loss(reward_a, reward_b, label):
       # label=1 means A preferred, label=0 means B preferred
       logit = reward_a - reward_b
       return F.binary_cross_entropy_with_logits(logit, label)
   ```

3. **Training loop** (`train.py`):
   - Load preference data, split 80/20 train/val.
   - Train for 50-100 epochs (dataset will be small at first).
   - Log train/val loss. Save the best checkpoint.
   - Start with synthetic preference data if you don't have enough real pairs yet (e.g., prefer patterns with more `stack()` layers, or prefer patterns that use the same instrument as the shape).

**Deliverable:** `python train.py` converges on your preference data, saves `critic/checkpoints/best.pt`.

---

### Day 9 · Mon Mar 30 — Critic inference server

**Goal:** The browser can query the critic for a reward score.

1. **Build `critic/serve.py`** — A lightweight Flask or FastAPI endpoint:
   - `POST /score` — Accepts `{ geometricContext, code }`, returns `{ reward: float }`.
   - Loads the trained model from checkpoint on startup.
   - Featurizes the input using the same pipeline as training.

2. **Wire into `src/llm-service.ts`**:
   ```typescript
   export async function scorePattern(context: GeometricContext, code: string): Promise<number>
   ```
   - POSTs to `http://localhost:5000/score`.

3. **Test** — Generate a few patterns with Claude, score each with the critic, verify that preferred patterns get higher scores.

**Deliverable:** `curl -X POST localhost:5000/score -d '{"context":..., "code":...}'` returns a reward float.

---

### Day 10 · Tue Mar 31 — Critic-guided generation (Actor-Critic loop)

**Goal:** Instead of showing raw A/B, use the critic to pre-rank candidates.

1. **Generate-then-rank pipeline** — New function in `src/llm-service.ts`:
   ```typescript
   async function generateBestPattern(context: string, n = 4): Promise<{ code: string; score: number }> {
     const candidates = await Promise.all(
       Array.from({ length: n }, () => generateStrudelCode(context))
     );
     const scored = await Promise.all(
       candidates.map(async code => ({ code, score: await scorePattern(geometricContext, code) }))
     );
     scored.sort((a, b) => b.score - a.score);
     return scored[0];
   }
   ```

2. **Two-mode UI**:
   - **Exploration mode** (A/B comparison) — Used to collect preference data. Keep this for ongoing training.
   - **Exploitation mode** (auto-best) — Generates N candidates, picks the highest-scored one, and loads it directly into the textarea. Add a "Auto-Generate Best" button.

3. **Feedback loop** — When in exploitation mode, still show a subtle "Was this good?" thumbs-up/down after each auto-generation. This creates single-signal data you can convert to pairwise (pair a thumbs-up with a thumbs-down from the same session).

**Deliverable:** "Auto-Generate Best" button produces a critic-ranked pattern.

---

### Day 11 · Wed Apr 1 — Online learning + retraining pipeline

**Goal:** The critic improves as the user keeps providing feedback.

1. **Incremental data accumulation** — Every A/B pick or thumbs-up/down appends to a `preferences.jsonl` file (one JSON object per line, easy to append).

2. **Retrain script** — `critic/retrain.sh`:
   ```bash
   #!/bin/bash
   python train.py --data data/preferences.jsonl --checkpoint checkpoints/best.pt --epochs 20
   ```
   - Warm-starts from the last checkpoint.
   - Runs in ~10 seconds on a small dataset with a 3-layer MLP.
   - Can be triggered manually or on a schedule.

3. **Hot-reload on the server** — After retraining, `serve.py` detects the new checkpoint (file watcher or manual `/reload` endpoint) and swaps the model weights without restarting.

4. **Logging + dashboard** — Add a simple stats display to the A/B panel:
   - Total preference pairs collected.
   - Critic's average confidence (sigmoid of reward delta) on recent pairs.
   - Train/val loss trend.

**Deliverable:** After 10+ new A/B picks, run `retrain.sh`, hit `/reload`, and verify the critic's rankings shift.

---

### Day 12 · Thu Apr 2 — Integration test + documentation + next steps

**Goal:** Verify the full loop works end-to-end and document everything.

1. **End-to-end test session**:
   - Start from scratch: open the interface, spawn shapes, open A/B panel.
   - Generate 5 pairs, pick preferences, download the JSON.
   - Train the critic, start the scoring server.
   - Switch to exploitation mode, generate 3 auto-best patterns. Are they noticeably better than random?
   - Collect 5 more preferences in A/B mode, retrain, check if rankings improve.

2. **Document the architecture** — Update `CLAUDE.md` at project root with:
   - How to start all three servers (Vite dev, Express proxy, Flask critic).
   - The data flow diagram from this document.
   - How to retrain the critic.

3. **Identify next steps for the rest of the semester**:
   - Upgrade from hand-crafted features to learned Strudel code embeddings (small transformer or LSTM over tokens).
   - Experiment with GRPO-style training — generate a group of candidates, rank by critic, use the ranking as a reward signal to fine-tune Claude's prompt or a local model.
   - Bayesian search over the LLM's temperature/prompt variations, using the critic as the objective function (ties directly to your proposal's mention of Bayesian optimization).

---

## Daily Calendar View

| Day | Date       | Focus                          | Hours |
|-----|------------|--------------------------------|-------|
| 1   | Fri Mar 20 | Claude API proxy + prompt draft | 1.5   |
| 2   | Sat Mar 21 | Geometric serializer + service  | 1.5   |
| —   | Sun Mar 22 | *Off*                           | —     |
| 3   | Mon Mar 23 | A/B comparison UI               | 1.5   |
| 4   | Tue Mar 24 | Wire generation into A/B flow   | 1.5   |
| 5   | Wed Mar 25 | Prompt iteration + quality      | 1.5   |
| 6   | Thu Mar 26 | Preference data pipeline        | 1.5   |
| 7   | Fri Mar 27 | PyTorch setup + features        | 1.5   |
| 8   | Sat Mar 28 | Bradley-Terry reward model      | 1.5   |
| —   | Sun Mar 29 | *Off*                           | —     |
| 9   | Mon Mar 30 | Critic inference server         | 1.5   |
| 10  | Tue Mar 31 | Critic-guided generation        | 1.5   |
| 11  | Wed Apr 1  | Online learning + retraining    | 1.5   |
| 12  | Thu Apr 2  | E2E test + docs + next steps    | 1.5   |

**Total: 18 hours**

---

## Tech Stack Summary

| Component        | Technology                     | Location           |
|------------------|--------------------------------|--------------------|
| Sonification UI  | TypeScript + Vite + Canvas     | `src/`             |
| Audio engine     | @strudel/core + @strudel/webaudio | (existing)      |
| LLM proxy        | Express + @anthropic-ai/sdk    | `server/`          |
| Preference UI    | HTML/CSS overlay (in `index.html`) | `src/ab-session.ts` |
| Preference data  | JSON/JSONL files               | `critic/data/`     |
| Reward model     | PyTorch (3-layer MLP)          | `critic/model.py`  |
| Critic server    | Flask or FastAPI               | `critic/serve.py`  |

---

## Risk Mitigation

**Risk: Claude produces invalid Strudel code frequently.**
*Mitigation:* Validation wrapper that tries `eval()` in a sandboxed Strudel context. Auto-retry once with the error message. Fall back to template-based generation (your existing `toStrudelCode()` with randomized parameters) if Claude fails twice.

**Risk: Not enough preference data to train a meaningful critic.**
*Mitigation:* Seed with synthetic preferences (e.g., "patterns using the shape's instrument are always preferred over mismatched instruments"). 20-30 real pairs should be enough for the small MLP to start showing directional learning.

**Risk: A/B comparison is slow because Claude API has latency.**
*Mitigation:* Pre-generate pairs in the background. When the user opens the A/B panel, a pair is already waiting. Generate the next pair while they listen.

**Risk: Day runs over 1.5 hours.**
*Mitigation:* Each day has one clear deliverable. If you're behind, skip the polish and move to the next day's core task. Days 5 (prompt iteration) and 12 (testing) are natural buffer days.
