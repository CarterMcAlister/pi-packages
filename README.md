# pi-packages

## Packages

| Package                                | Notes                                                          |
| -------------------------------------- | -------------------------------------------------------------- |
| `@carter-mcalister/pi-auto-name`       | English-only automatic session naming for Pi                   |
| `@carter-mcalister/pi-profiles`        | Session-scoped profile loader for Pi                           |
| `@carter-mcalister/pi-rlm`             | RLM-first recursive workflows and named workflow runs for Pi   |
| `@carter-mcalister/pi-skillpacks`      | Session-scoped skill pack loader for Pi                        |
| `@carter-mcalister/pi-mise-toolchain`  | Mise-driven toolchain enforcement and command rewriting for Pi |
| `@carter-mcalister/pi-worktrunk`       | Worktrunk-backed worktree management for Pi                    |

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
pi install npm:@carter-mcalister/pi-profiles
pi install npm:@carter-mcalister/pi-rlm
pi install npm:@carter-mcalister/pi-skillpacks
pi install npm:@carter-mcalister/pi-mise-toolchain
pi install npm:@carter-mcalister/pi-worktrunk
```

## Credits

The forked packages in this monorepo build on upstream work by their original authors:

- `@carter-mcalister/pi-mise-toolchain` is forked from [`@aliou/pi-toolchain`](https://github.com/aliou/pi-toolchain)
- `@carter-mcalister/pi-worktrunk` is forked from [`@zenobius/pi-worktrees`](https://github.com/zenobi-us/pi-worktrees)

