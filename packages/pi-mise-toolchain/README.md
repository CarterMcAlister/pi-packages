# `@cmc/pi-mise-toolchain`

Opinionated, mise-driven toolchain enforcement for Pi. Transparently rewrites commands to use preferred tools instead of blocking and forcing retries.

## Installation

```bash
pi install npm:@cmc/pi-mise-toolchain
```

Or install directly from this monorepo during local development:

```bash
pi install /absolute/path/to/pi-packages/packages/pi-mise-toolchain
```

## Features

### Rewriters (transparent, via spawn hook)

These features rewrite commands before shell execution. By default the agent does not see that the command was changed, but you can enable optional rewrite notifications in the config.

- **enforcePackageManager**: Rewrites `npm`/`yarn`/`bun` commands to the package manager derived from the nearest `mise.toml`. Also handles `npx` -> `pnpm dlx`/`bunx`. Activates only when exactly one of `bun`, `pnpm`, or `npm` is declared in `[tools]`.
- **rewritePython**: Rewrites `python`/`python3` to `uv run python` and `pip`/`pip3` to `uv pip`. Activates when `uv` is declared in the nearest `mise.toml` `[tools]` table.
- **gitRebaseEditor**: Injects `GIT_EDITOR=true` and `GIT_SEQUENCE_EDITOR=:` env vars for `git rebase` commands so they run non-interactively.

### Blockers (via tool_call hooks)

Blockers are still used when a rewrite is not safe to apply automatically.

- **python confirm** (part of `rewritePython`): When python/pip is used outside a uv project (no `pyproject.toml`), shows a confirmation dialog. Also blocks `poetry`/`pyenv`/`virtualenv` unconditionally.

Dangerous command presets such as `brew` and Docker secret blocking now live in `@aliou/pi-guardrails`.

## Settings Command

Run `/toolchain:settings` to open an interactive settings UI with two tabs:

- **Global**: edit global extension config (`~/.pi/agent/extensions/toolchain.json`)
- **Memory**: edit session-only overrides (not persisted)

Use `Tab` / `Shift+Tab` to switch tabs. The settings UI controls extension-owned settings such as `gitRebaseEditor` and `bash.sourceMode`.

Package-manager and Python rewrites are derived from the nearest `mise.toml` and are not editable in the settings UI.

## Configuration

Configuration is split by responsibility:

- **Global JSON config**: `~/.pi/agent/extensions/toolchain.json`
- **Memory config**: session-only overrides via `/toolchain:settings`
- **Project toolchain config**: nearest `mise.toml`

### Global JSON Configuration Schema

```json
{
  "enabled": true,
  "features": {
    "gitRebaseEditor": "rewrite"
  },
  "bash": {
    "sourceMode": "override-bash"
  },
  "ui": {
    "showRewriteNotifications": false
  }
}
```

All fields are optional. Missing fields use the defaults shown above.

### Project `mise.toml` Rules

The nearest `mise.toml` controls project-level rewrites:

- If `[tools]` declares `uv`, Python rewrites are enabled.
- If `[tools]` declares exactly one of `bun`, `pnpm`, or `npm`, package-manager rewrites are enabled and that manager is selected.
- If `[tools]` declares zero or multiple supported package managers, package-manager rewrites are disabled.

### Defaults

| Setting | Default | Description |
| --- | --- | --- |
| `features.gitRebaseEditor` | `"rewrite"` | On by default. Injects non-interactive env vars for git rebase. |
| `bash.sourceMode` | `"override-bash"` | Select how rewrite hooks reach bash at runtime. Only matters when at least one rewrite is active. |
| `ui.showRewriteNotifications` | `false` | Show a visible Pi notification each time a rewrite happens. |
| Python rewrites | derived from `mise.toml` | Enabled when `uv` is declared in `[tools]`. |
| Package-manager rewrites | derived from `mise.toml` | Enabled only when exactly one of `bun`, `pnpm`, or `npm` is declared in `[tools]`. |

### Examples

Use composed bash integration with an external bash composer:

```json
{
  "bash": {
    "sourceMode": "composed-bash"
  }
}
```

Enable rewrite notifications in global config:

```json
{
  "ui": {
    "showRewriteNotifications": true
  }
}
```

Enable project-level rewrites through `mise.toml`:

```toml
[tools]
uv = "latest"
bun = "1.3.12"
```

## How It Works

### Rewriters vs Blockers

The extension uses two Pi mechanisms:

1. **Spawn hook** (`createBashTool` with `spawnHook`): rewrites commands before shell execution. The agent sees the original command in the tool call UI but gets the output of the rewritten command.
2. **tool_call event hooks**: block commands entirely. The agent sees a block reason and retries with the correct command. Used for commands that have no safe rewrite target.
3. **Optional rewrite notifications**: when `ui.showRewriteNotifications` is enabled, a warning-level Pi notification is shown before the rewritten command runs. The message is prefixed with `[override-bash]` or `[composed-bash]` for debug clarity.

### Execution Order

1. Guardrails `tool_call` hooks run first (permission gate, env protection)
2. Toolchain `tool_call` hooks run (blockers, optional rewrite notifications)
3. If not blocked and at least one feature is in `rewrite` mode, runtime routing depends on `bash.sourceMode`:
   - `override-bash`: toolchain registers its own bash tool with spawn hook
   - `composed-bash`: toolchain waits for an external composer to request and compose its spawn hook
4. Shell executes the rewritten command

### AST-Based Rewriting

All rewriters use structural shell parsing via `@aliou/sh` to identify command names in the AST. This avoids false positives where tool names appear in URLs, file paths, or strings. If the parser fails, the command passes through unchanged — a missed rewrite is safe, a false positive rewrite corrupts the command.

## Bash Source Mode

`bash.sourceMode` controls how rewrite hooks attach to bash at runtime.

- `override-bash` (default): toolchain registers bash when rewrite is active.
- `composed-bash`: toolchain contributes its rewrite hook to an external bash composer.

Important:

- Source mode matters only when at least one feature is set to `"rewrite"`.
- Features set to `"block"` are unaffected.
- In `override-bash` mode, Pi core still uses first-wins tool registration. If another extension earlier in load order already registered `bash`, toolchain cannot replace it.
- In `composed-bash` mode, rewrites run only if an external composer emits `ad:bash:spawn-hook:request` and collects contributors.
- If no composer exists, rewrites will not run in `composed-bash` mode by design.

## Migration from Guardrails

If you were using `preventBrew`, `preventPython`, or `enforcePackageManager` in your guardrails config:

1. Install `@cmc/pi-mise-toolchain`
2. Add the project tool choices to `mise.toml` (`uv` for Python, exactly one of `bun` / `pnpm` / `npm` for package-manager rewrites)
3. Optionally configure extension-owned settings in `~/.pi/agent/extensions/toolchain.json`
4. Remove the deprecated features from your guardrails config

The guardrails extension will continue to honor these features with a deprecation warning until they are removed in a future version.

## Development

```bash
mise install
bun install
mise run check
```
