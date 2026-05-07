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
