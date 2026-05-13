# `@carter-mcalister/pi-utils`

A grab-bag of personal [Pi Coding Agent](https://github.com/badlogic/pi-mono) extensions, packaged together for easy install.

## What's included

| Extension         | Slash command(s)  | Notes                                                                                     |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `context`         | `/context`        | Small TUI view of loaded extensions, skills, project context files, and token/cost usage  |
| `files`           | `/files`, `/diff` | File picker over the git tree + session-referenced files, with reveal/open/edit/diff      |
| `loop`            | `/loop`           | Background review/iteration loop helper                                                   |
| `notify`          | _(event hook)_    | Native terminal notification when the agent finishes a turn (OSC 777 / OSC 99 / WT toast) |
| `whimsical`       | _(spinner hook)_  | Replaces the boring "Thinking..." spinner with a rotating list of whimsical verbs         |
| `mac-key-display` | `/hotkeys`        | On macOS, rewrites displayed modifier names only: Alt→Option, Ctrl→Control, Super→Command |
| `pi-review-loop`  | `/review`         | Automated code-review loop with configurable settings                                     |

## Install

```bash
pi install npm:@carter-mcalister/pi-utils
```

For local development from the package directory:

```bash
pi install .
```

If Pi is already running, use `/reload` after installing.

## Development

```bash
mise install
bun install
mise run check
```

## Notes

- All extensions were migrated from `~/.pi/agent/extensions/`.
- Imports were updated from the legacy `@mariozechner/*` namespace to `@earendil-works/*` to match the rest of the monorepo.
