# pi-packages

A Bun-first monorepo for my Pi packages.

## Packages

| Directory                    | Package                  | Notes                                                          |
| ---------------------------- | ------------------------ | -------------------------------------------------------------- |
| `packages/pi-skillpacks`     | `@cmc/pi-skillpacks`     | Session-scoped skill pack loader for Pi                        |
| `packages/pi-mise-toolchain` | `@cmc/pi-mise-toolchain` | Mise-driven toolchain enforcement and command rewriting for Pi |
| `packages/pi-worktrunk`      | `@cmc/pi-worktrunk`      | Worktrunk-backed worktree management for Pi                    |

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

You can also call the underlying Bun scripts directly:

```bash
bun run format
bun run lint
bun run typecheck
bun run test
bun run check
```

## Credits

The forked packages in this monorepo build on upstream work by their original authors:

- `@cmc/pi-mise-toolchain` is forked from [`@aliou/pi-toolchain`](https://github.com/aliou/pi-toolchain)
- `@cmc/pi-worktrunk` is forked from [`@zenobius/pi-worktrees`](https://github.com/zenobi-us/pi-worktrees)

## Install individual packages in Pi

```bash
pi install npm:@cmc/pi-skillpacks
pi install npm:@cmc/pi-mise-toolchain
pi install npm:@cmc/pi-worktrunk
```

For local development, you can also install from a package directory inside this monorepo:

```bash
pi install /absolute/path/to/pi-packages/packages/pi-skillpacks
pi install /absolute/path/to/pi-packages/packages/pi-mise-toolchain
pi install /absolute/path/to/pi-packages/packages/pi-worktrunk
```
