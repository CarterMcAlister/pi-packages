---
name: ask-user
description: "Use request_user_input before high-stakes architectural decisions, irreversible changes, or ambiguous requirements. Summarize context, present structured Codex-compatible options, collect explicit user choice, then proceed."
metadata:
  short-description: Codex-compatible decision gate
---

# Codex-Compatible Ask User Decision Gate

Use this skill to force explicit user alignment before consequential decisions.

This package exposes `request_user_input`, not `ask_user`. Keep the Codex-compatible tool shape:

```json
{
  "questions": [
    {
      "id": "decision_id",
      "header": "Decision",
      "question": "Which option should we use?",
      "options": [
        { "label": "Recommended (Recommended)", "description": "Best default for the current constraints." },
        { "label": "Alternative", "description": "Useful when the trade-off matters more." }
      ]
    }
  ]
}
```

## Non-Negotiable Rule

Invoke `request_user_input` before proceeding when any of the following is true:

1. The next step changes architecture, schema, API contracts, deployment strategy, or security posture.
2. The work is costly to undo, such as a large refactor, migration, destructive edit, or production-facing behavior change.
3. Requirements, constraints, or success criteria are unclear, conflicting, or missing.
4. Multiple valid options exist and the trade-off is preference-dependent.
5. You are about to assume something that can materially change implementation.

Do not skip this gate unless the user has already provided a clear, explicit decision for the exact trade-off.

## Decision Handshake

1. Gather evidence from code, docs, logs, or tool output first.
2. Summarize current state, constraints, trade-offs, and your recommendation.
3. Ask one focused question when possible; never exceed three questions in one call.
4. Provide 2-3 mutually exclusive choices per question.
5. Put the recommended option first and suffix its label with `(Recommended)`.
6. Do not include an Other option; the tool adds `None of the above` as a freeform path.
7. Keep option labels unique and do not start labels with `user_note: ` because that prefix marks optional notes in results.
8. Restate the decision and proceed.

## Retry/Cancel Policy

- Max 2 attempts for the same decision boundary.
- If a high-stakes decision is cancelled or unclear after the second attempt, stop and report blocked.
- If the ambiguity is low-stakes and the user explicitly delegates the choice, proceed with the most reversible default and state assumptions.

## Payload Quality

Good questions are concrete and decision-oriented:

- “Which caching strategy should we use for v1?”
- “Do you want the fast rollout or the safer migration path?”

Avoid broad prompts, unrelated multipart questions, and questions that should be answered by reading the code first.
