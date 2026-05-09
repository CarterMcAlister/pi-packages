# pi-packages

A monorepo of Pi extensions, utilities, and Codex-compatible tool packages.

## Packages

| Package                                | Notes                                                |
| -------------------------------------- | ---------------------------------------------------- |
| `@carter-mcalister/pi-auto-name`       | English-only automatic session naming for Pi         |
| `@carter-mcalister/pi-codex-ask-user`  | Codex-compatible `request_user_input` tool for Pi    |
| `@carter-mcalister/pi-codex-image-gen` | Codex-compatible `image_generation` tool for Pi      |
| `@carter-mcalister/pi-codex-subagents` | Codex-compatible MultiAgentV2 subagent tools for Pi  |
| `@carter-mcalister/pi-codex-tasks`     | Codex-compatible task planning tools for Pi          |
| `@carter-mcalister/pi-codex-tools`     | Codex-compatible tool surface for Pi                 |
| `@carter-mcalister/pi-profiles`        | Session-scoped profile loader for Pi                 |
| `@carter-mcalister/pi-protected-files` | Project-configurable protected file gates for Pi     |
| `@carter-mcalister/pi-skillpacks`      | Session-scoped skill pack loader for Pi              |
| `@carter-mcalister/pi-utils`           | Grab-bag of Pi extensions: /context, /files, /loop, /whimsical, notify, pi-review-loop |
| `@carter-mcalister/pi-worktrunk`       | Worktrunk-backed worktree extension for Pi Coding Agent |

## Getting started

```bash
mise install
mise run setup
```

## Common commands

```bash
mise run format
mise run lint
mise run typecheck
mise run test
mise run check
```

## Install individual packages in Pi

```bash
pi install npm:@carter-mcalister/pi-auto-name
pi install npm:@carter-mcalister/pi-codex-ask-user
pi install npm:@carter-mcalister/pi-codex-image-gen
pi install npm:@carter-mcalister/pi-codex-subagents
pi install npm:@carter-mcalister/pi-codex-tasks
pi install npm:@carter-mcalister/pi-codex-tools
pi install npm:@carter-mcalister/pi-profiles
pi install npm:@carter-mcalister/pi-protected-files
pi install npm:@carter-mcalister/pi-skillpacks
pi install npm:@carter-mcalister/pi-utils
pi install npm:@carter-mcalister/pi-worktrunk
```

## Credits

The forked packages in this monorepo build on upstream work by their original authors:

- `@carter-mcalister/pi-worktrunk` is forked from [`@zenobius/pi-worktrees`](https://github.com/zenobi-us/pi-worktrees)
