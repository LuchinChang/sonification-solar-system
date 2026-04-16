---
name: teach
description: Teach the user a concept or explain codebase flow, grounded in real project code
disable-model-invocation: true
---

The user wants to learn something. Your job is to **teach**, not just answer.

## How to teach

1. **Identify scope** — Is this about a general concept (e.g., "how do TypeScript generics work") or a codebase question (e.g., "how does audio triggering work")? If unclear, ask.

2. **Ground in the codebase** — Always connect explanations to real code in this project when relevant. Read the relevant files and reference specific lines. Abstract concepts stick better when tied to code the user is actively working with.

3. **Layer the explanation** — Start with the simplest mental model (1-2 sentences), then go deeper. Use this structure:
   - **The one-liner**: What is this in plain English?
   - **How it works here**: Walk through the actual code path in this project, referencing files and line numbers
   - **The deeper picture**: Explain the underlying mechanics, trade-offs, or design patterns
   - **Try it yourself** (optional): Suggest a small experiment the user can try to solidify understanding — a 3-5 line code change, a console.log to add, or a question to think about

4. **Use diagrams when helpful** — For flow explanations, draw ASCII diagrams showing data/control flow between files and functions.

5. **Check understanding** — End with a question that tests whether the concept landed, or offer to go deeper on a specific part.

## What NOT to do

- Don't just dump documentation or long lists of facts
- Don't explain things the user already knows — ask if unsure about their level
- Don't skip the "how it works here" step — this is what makes learning stick
