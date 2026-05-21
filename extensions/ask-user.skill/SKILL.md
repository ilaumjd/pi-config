---
name: ask-user
description: "You MUST use this before high-stakes architectural decisions, irreversible changes, or when requirements are ambiguous. Runs a decision handshake with the ask_user tool: summarize context, present structured options, collect explicit user choice, then proceed."
metadata:
  short-description: Decision gate for ambiguity and high-stakes choices
---

# Ask User Decision Gate

Use this skill to force explicit user alignment before consequential decisions.

## Non-negotiable rule

Invoke `ask_user` before proceeding when **any** of the following is true:

1. The next step changes architecture, schema, API contracts, deployment strategy, or security posture.
2. The work is costly to undo (large refactor, migration, destructive edit, production-facing behavior change).
3. Requirements, constraints, or success criteria are unclear, conflicting, or missing.
4. Multiple valid options exist and the trade-off is preference-dependent.
5. You are about to assume something that can materially change implementation.

Do **not** skip this gate unless the user has already provided a clear, explicit decision for the exact trade-off.

## Agent Protocol

### 1) Detect boundary
Classify the current step as `high_stakes`, `ambiguous`, `both`, or `clear`.

### 2) Gather evidence first
Do not ask the user to decide blind.

### 3) Synthesize context
Prepare a short neutral summary (3-7 bullets) covering current state, constraints, trade-offs, and recommendation.

### 4) Ask one focused question
Call `ask_user` with `question`, `context`, `options` (2-5 choices), `allowFreeform: true`. Ask exactly one question per call.

### 5) Commit the decision
Restate the decision, state what will be done next, then proceed.

### 6) Re-open only on new ambiguity
Avoid repetitive confirmation loops.

## Guardrails

- **Max 1** `ask_user` call per boundary (2 if first was unclear/cancelled).
- After attempt 2: if `high_stakes` — stop and mark blocked; if `ambiguous` only and user says "your call" — proceed with most reversible default.
- Never ask the same trade-off again without new evidence.
