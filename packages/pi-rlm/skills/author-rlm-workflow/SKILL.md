---
name: author-rlm-workflow
description: Author project-local RLM workflow definitions for `.pi/rlm/tasks/*.ts`. Use when the user wants a new named workflow backed by `@ax-llm/ax` agents.
---

# Author RLM Workflow Definitions

Project-local workflows live in:

```text
.pi/rlm/tasks/*.ts
```

Each workflow should default export an object with:

- `id`
- `description`
- optional `inputSchema`
- optional `examples`
- optional `defaultModel`
- `prepare(context)`
- optional `formatResult(...)`

## Guidelines

- Keep workflow ids short and stable.
- Prefer Ax RLM only for workflows that need iterative analysis.
- Use least-privilege `AxJSRuntime` defaults.
- Resolve file/text inputs in `prepare(...)`.
- Return concise summaries plus structured details.
- If the workflow needs clarification, use an explicit clarification answer field like `audienceAnswer` and set the clarification mapping accordingly.
- Follow current Ax guidance: `agent(...)`, `contextPolicy: { preset: 'checkpointed', budget: 'balanced' }`, and `mode: 'simple'` unless recursive child agents are actually needed.

## Suggested starting points

- copy a bundled workflow
- adapt the output schema
- update the actor instructions for your rubric
