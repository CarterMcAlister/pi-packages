# @carter-mcalister/pi-codex-tasks

Codex-compatible task planning for Pi.

This package exposes Codex's `update_plan` task/checklist tool surface:

```json
{
  "explanation": "optional note",
  "plan": [
    { "step": "Inspect the code", "status": "completed" },
    { "step": "Patch the bug", "status": "in_progress" },
    { "step": "Run validation", "status": "pending" }
  ]
}
```

It intentionally does **not** expose Claude/Pi-style `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskExecute`, `TaskOutput`, or `TaskStop` tools. Load `pi-codex-subagents` alongside this package for the Codex MultiAgentV2 subagent surface: `spawn_agent`, `send_message`, `followup_task`, `wait_agent`, `close_agent`, and `list_agents`.

## UI

The tool surface remains Codex-compatible, while the persistent widget mirrors the richer `pi-tasks` presentation:

- Themed task summary above the editor: `● 3 tasks (1 done, 1 in progress, 1 open)`
- Synthetic task numbers (`#1`, `#2`, …) derived from the current plan order
- `✔`/`◼`/`◻` status icons, with completed items dimmed and struck through
- Animated `✳`/`✽` spinner for the active `in_progress` step
- Active-step elapsed time and per-turn token usage when Pi provides usage data
- Terminal-width truncation and overflow display after 10 visible items
- `/tasks` menu for viewing, creating, starting, completing, deleting, and clearing plan steps

Because Codex `update_plan` items only contain `step` and `status`, this package does not add `pi-tasks` features that require extra tool fields such as persistent task IDs, descriptions, dependencies, owners, metadata, settings, persistence, or subagent execution state.
