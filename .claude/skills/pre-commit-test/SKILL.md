---
name: pre-commit-test
description: Run vitest + tsc to validate changes before committing
disable-model-invocation: true
---

Run the following checks in sequence:

1. `npx vitest run` — all unit tests must pass
2. `npx tsc --noEmit` — no type errors allowed

If both pass, report success and confirm the changes are ready to commit.
If either fails, diagnose the failure and fix the issue before re-running.
