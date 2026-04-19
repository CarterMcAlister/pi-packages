---
name: use-rlm-workflow
description: Use the `rlm_task` tool or `/rlm-task` command for repeatable, long-context, rubric-driven workflows such as incident reviews, RFC checks, dataset analysis, and manager-ready summaries with evidence.
---

# Use RLM Workflows

Use `rlm_task` when the user asks for a named workflow that is:

- repeatable
- based on a rubric or checklist
- large-context or multi-step
- better served by structured outputs than ad-hoc prompting

Prefer normal Pi tools for:

- simple edits
- quick shell commands
- one-off Q&A

## Examples

- "Run `incident-review` on `docs/incidents/foo.md`."
- "Use `rfc-quality-check` on this design doc."
- "Analyze this export with a named workflow and summarize the findings."

## Good behavior

- Call `rlm_task` with the workflow id and compact string inputs.
- Reuse the current Pi model unless the user explicitly names another model.
- If the workflow asks a clarification question, answer it through Pi UI and resume.
