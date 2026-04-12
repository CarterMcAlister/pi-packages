# pi-packages

A Bun-first monorepo for Carter McAlister's Pi packages.

## Packages

| Directory | Package | Notes |
| --- | --- | --- |
| `packages/pi-skillpacks` | `@cmc/pi-skillpacks` | Session-scoped skill pack loader for Pi |
| `packages/pi-mise-toolchain` | `@cmc/pi-mise-toolchain` | Mise-driven toolchain enforcement and command rewriting for Pi |
| `packages/pi-worktrunk` | `@cmc/pi-worktrunk` | Worktrunk-backed worktree management for Pi |

## Tooling

This repo is set up to use:

- **Bun** for package management, scripts, and test execution
- **mise** for tool installation and task orchestration
- **Biome** for formatting and linting
- **Lefthook** for `pre-commit` and `pre-push` git hooks

## Getting started

```bash
mise install
bun install
```

Git hooks are installed automatically via the root `prepare` script. If you need to reinstall them manually:

```bash
bun run prepare
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
