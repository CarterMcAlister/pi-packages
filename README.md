# pi-packages

A monorepo of Pi extensions, utilities, and Codex-compatible tool packages.

## Packages

| Package                                | Directory                      | Notes                                                                                              |
| -------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `@carter-mcalister/pi-auto-name`       | `packages/pi-auto-name`        | English-only automatic session naming for Pi                                                       |
| `pi-ask-user`                          | `packages/pi-codex-ask-user`   | Interactive `ask_user` tool and bundled decision-gating skill for Pi                               |
| `@carter-mcalister/pi-codex-image-gen` | `packages/pi-codex-image-gen`  | Codex-compatible `image_generation` tool for Pi                                                    |
| `@carter-mcalister/pi-codex-subagents` | `packages/pi-codex-subagents`  | Codex-compatible MultiAgentV2 subagent tools for Pi                                                |
| `@carter-mcalister/pi-codex-tasks`     | `packages/pi-codex-tasks`      | Codex-compatible task planning tools for Pi                                                        |
| `@carter-mcalister/pi-codex-tools`     | `packages/pi-codex-tools`      | Codex-compatible tool surface for Pi                                                               |
| `@carter-mcalister/pi-glimpse-url-app` | `packages/pi-glimpse-url-app`  | Private macOS Glimpse URL helper app for Plannotator                                               |
| `pi-lens`                              | `packages/pi-lens`             | Real-time code feedback for Pi: LSP, formatters, linters, and structural analysis                  |
| `@victor-software-house/pi-multicodex` | `packages/pi-multicodex`       | Codex account rotation extension for Pi                                                            |
| `pi-powerline-footer`                  | `packages/pi-powerline-footer` | Powerline-style status bar, fixed editor, bash mode, and prompt UX extensions                      |
| `@carter-mcalister/pi-profiles`        | `packages/pi-profiles`         | Session-scoped profile loader for Pi                                                               |
| `@carter-mcalister/pi-protected-files` | `packages/pi-protected-files`  | Project-configurable protected file gates for Pi                                                   |
| `@carter-mcalister/pi-skillpacks`      | `packages/pi-skillpacks`       | Session-scoped skill pack loader for Pi                                                            |
| `@carter-mcalister/pi-utils`           | `packages/pi-utils`            | Grab-bag of Pi extensions: `/context`, `/files`, `/loop`, `/whimsical`, notify, and pi-review-loop |
| `@carter-mcalister/pi-worktrunk`       | `packages/pi-worktrunk`        | Worktrunk-backed worktree extension for Pi Coding Agent                                            |

## Getting started

```bash
mise install
mise run setup
```

## Glimpse URL App

`@carter-mcalister/pi-glimpse-url-app` is a local macOS helper for Plannotator. Plannotator normally opens review and annotation gates in a browser; this helper installs `Glimpse URL.app` so `PLANNOTATOR_BROWSER="Glimpse URL"` opens those plan-review windows in native Glimpse instead. It is mainly used for Plannotator setup-goal reviews, `plannotator annotate --gate`, and other Plannotator approval flows that should feel like an integrated Pi review surface instead of a separate browser tab.

Install or refresh it with:

```bash
bun run --cwd packages/pi-glimpse-url-app install-app
```

## Common commands

```bash
mise run format
mise run lint
mise run typecheck
mise run test
mise run check
```

## Install Individual Pi Packages

```bash
pi install npm:@carter-mcalister/pi-auto-name
pi install npm:pi-ask-user
pi install npm:@carter-mcalister/pi-codex-image-gen
pi install npm:@carter-mcalister/pi-codex-subagents
pi install npm:@carter-mcalister/pi-codex-tasks
pi install npm:@carter-mcalister/pi-codex-tools
pi install npm:pi-lens
pi install npm:@victor-software-house/pi-multicodex
pi install npm:pi-powerline-footer
pi install npm:@carter-mcalister/pi-profiles
pi install npm:@carter-mcalister/pi-protected-files
pi install npm:@carter-mcalister/pi-skillpacks
pi install npm:@carter-mcalister/pi-utils
pi install npm:@carter-mcalister/pi-worktrunk
```

`@carter-mcalister/pi-glimpse-url-app` is private and is installed with its package script rather than through `pi install`.

## Credits

The forked and adapted packages in this monorepo build on upstream work by their original authors:

- `@carter-mcalister/pi-auto-name` replaces and adapts the workflow from [`@ryan_nookpi/pi-extension-auto-name`](https://www.npmjs.com/package/@ryan_nookpi/pi-extension-auto-name).
- `pi-ask-user` is forked from [`edlsh/pi-ask-user`](https://github.com/edlsh/pi-ask-user).
- `pi-lens` is forked from [`apmantza/pi-lens`](https://github.com/apmantza/pi-lens).
- `@victor-software-house/pi-multicodex` is vendored from [`victor-software-house/pi-multicodex`](https://github.com/victor-software-house/pi-multicodex).
- `pi-powerline-footer` is forked from [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer).
- `@carter-mcalister/pi-worktrunk` is forked from [`@zenobius/pi-worktrees`](https://github.com/zenobi-us/pi-worktrees).
