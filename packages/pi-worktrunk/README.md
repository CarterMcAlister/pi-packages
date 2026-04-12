# `@cmc/pi-worktrunk`

Worktrunk-backed worktree management for [Pi Coding Agent](https://github.com/badlogic/pi-mono).

This extension keeps a familiar `/worktree ...` command surface inside Pi, but it now delegates worktree behavior to [Worktrunk](https://worktrunk.dev/worktrunk/) instead of calling `git worktree` directly.

## What changed

`pi-worktrunk` is now a thin wrapper around `wt`:

- `/worktree create` → `wt switch --create --no-cd`
- `/worktree list` → `wt list --format=json`
- `/worktree remove` → `wt remove`
- `/worktree status` / `/worktree cd` use `wt list --format=json`

The extension **no longer reads** `~/.pi/agent/pi-worktrees-settings.json`.

Runtime behavior now comes from Worktrunk config files:

- user config: `~/.config/worktrunk/config.toml`
- project config: `.config/wt.toml`

## Install

### 1. Install the Pi extension

```bash
pi install npm:@cmc/pi-worktrunk
```

### 2. Install Worktrunk

macOS / Linux (Homebrew):

```bash
brew install worktrunk
```

Or follow the upstream install instructions:

- https://worktrunk.dev/worktrunk/
- https://github.com/max-sixty/worktrunk

### 3. Install Worktrunk shell integration

```bash
wt config shell install
```

### 4. Create Worktrunk config

User config:

```bash
wt config create
```

Project config:

```bash
wt config create --project
```

If Pi is already running, use `/reload` after installing the extension.

## Quick start

In Pi:

```text
/worktree init
/worktree create feature/auth-refactor
/worktree list
/worktree status
/worktree cd feature/auth-refactor
/worktree remove feature/auth-refactor
```

## Command reference

| Command | Behavior |
| --- | --- |
| `/worktree init` | Show Worktrunk setup guidance |
| `/worktree settings` | Show Worktrunk config info via `wt config show` |
| `/worktree create <branch>` | Create a worktree via Worktrunk |
| `/worktree list` | List worktrees and optionally switch via Worktrunk |
| `/worktree status` | Show the current worktree from Worktrunk JSON output |
| `/worktree cd <name>` | Print the matching worktree path |
| `/worktree remove <name>` | Remove a worktree via Worktrunk |
| `/worktree prune` | Deprecated; use Worktrunk-native cleanup flows |
| `/worktree templates` | Deprecated; use Worktrunk template docs |

Aliases retained:

- `/worktree ls` → `/worktree list`
- `/worktree rm` → `/worktree remove`
- `/worktree config` → `/worktree settings`
- `/worktree vars` / `/worktree tokens` → `/worktree templates`

## Configuration

This extension does **not** maintain its own runtime config anymore.

Use Worktrunk config instead:

### User config

`~/.config/worktrunk/config.toml`

Example:

```toml
worktree-path = "{{ repo_path }}/.worktrees/{{ branch | sanitize }}"

[projects."github.com/org/repo"]
worktree-path = ".worktrees/{{ branch | sanitize }}"
```

### Project config

`.config/wt.toml`

Example:

```toml
[pre-start]
deps = "bun install"

[post-start]
editor = "zellij action new-tab --name {{ branch | sanitize }} --cwd {{ worktree_path }}"

[list]
url = "http://localhost:{{ branch | hash_port }}"
```

See Worktrunk docs for full configuration:

- https://worktrunk.dev/config/
- https://worktrunk.dev/hook/
- https://worktrunk.dev/switch/
- https://worktrunk.dev/list/
- https://worktrunk.dev/remove/

## Removed extension-owned features

The Worktrunk-backed version intentionally drops behavior that duplicated Worktrunk:

- `~/.pi/agent/pi-worktrees-settings.json`
- repo pattern matching / matching strategies
- extension-managed `onCreate`, `onSwitch`, `onBeforeRemove`
- extension-managed branch generators
- `/worktree create --generate`
- `/worktree create --name`
- extension template preview for custom hook variables

If you used those features before, migrate them to Worktrunk config and hooks.

## Notes

- This extension expects `wt` to be installed and available on `PATH`.
- Pi keeps the `/worktree` command surface, but Worktrunk is now the source of truth.
- For directory switching in your shell, Worktrunk shell integration is still required.

## Development

```bash
mise install
bun install
mise run check
```
