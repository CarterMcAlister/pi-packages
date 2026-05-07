# pi-codex-subagents

Codex-compatible MultiAgentV2 subagent tools for Pi.

This package registers the Codex v2 collaboration tool surface:

- `spawn_agent`
- `send_message`
- `followup_task`
- `wait_agent`
- `close_agent`
- `list_agents`

The implementation uses background `pi --mode text` subprocesses and a persistent registry under `~/.pi/agent/extensions/pi-codex-subagents`. It mirrors Codex schemas and return shapes where Pi exposes equivalent behavior.

## Session Overlay

Press `Alt+Shift+A` in Pi to select a spawned subagent and open a read-only overlay showing the agent's session transcript plus stdout/stderr paths. The overlay follows the live tail by default and supports `q`/`Esc` to close, arrow keys to scroll, and Page Up/Page Down for paging.

## Compatibility Notes

- `fork_turns: "all"` maps to Pi `--fork <current-session-file>` when a saved parent session is available.
- Positive `fork_turns` values are accepted but Pi currently forks the full saved session because partial-turn CLI forks are not exposed.
- `send_message` queues a message without triggering a turn, matching Codex's non-waking semantics.
- `followup_task` triggers a new turn immediately when the agent is idle, or queues the follow-up to run after the current turn completes.
