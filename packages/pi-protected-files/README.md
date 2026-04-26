# @carter-mcalister/pi-protected-files

Project-configurable protected file gates for Pi.

This extension reads a config file from the current project and intercepts Pi tool calls before they run. Matching `write` and `edit` calls are either blocked or require explicit user approval.

## Install

```bash
pi install npm:@carter-mcalister/pi-protected-files
```

For local development in this monorepo, the root `package.json` also registers the extension with Pi.

## Config

Create `.agents/protected-files.jsonc` (or `.pi/protected-files.jsonc`) in your project:

```jsonc
{
  // Defaults to "block" when omitted.
  "mode": "block",
  "files": [
    ".env",
    "package-lock.json",
    "pnpm-lock.yaml",
    "schema.ts",
    "secrets/**",
    {
      "path": "config.ts",
      "mode": "confirm"
    }
  ]
}
```

Pi checks these files in order:

1. `.agents/protected-files.jsonc`
2. `.agents/protected-files.json`
3. `.pi/protected-files.jsonc`
4. `.pi/protected-files.json`
5. `pi-protected-files.jsonc`
6. `pi-protected-files.json`

## Modes

- `block`: matching edits are denied before the tool runs.
- `confirm`: Pi prompts before allowing the edit. If Pi is running without a UI, the edit is blocked.

The top-level `mode` is the default for all files. Individual entries can override it with their own `mode`.

## Commands

- `/disable-protections`: disables all protected file guards for the rest of the current Pi session. Restart or reload the session to enable protections again.

## Matching Rules

- Plain filenames, such as `.env`, match that basename anywhere in the project.
- Non-glob paths, such as `src/schema.ts`, are treated as filenames; only `schema.ts` is used.
- Filename globs, such as `*.lock`, match basenames anywhere in the project.
- Path globs with `/`, such as `secrets/**`, match project-relative paths and any nested parent folder named `secrets`.

## What Is Protected

The extension protects:

- Pi `write` tool calls.
- Pi `edit` tool calls.
- Nested `write` and `edit` calls inside `multi_tool_use.parallel`.
- Common mutating `bash` commands that explicitly mention a protected path, such as redirection, `tee`, `sed -i`, `mv`, `cp`, `rm`, `truncate`, and `touch`.

Shell command protection is best-effort because arbitrary commands can modify files without naming them in the command text. For critical files, prefer `block` mode and avoid broad shell commands that may indirectly rewrite protected files.

## Why This Approach

Pi extensions can intercept `tool_call` events before execution and return `{ "block": true }`. That is the safest extension-level hook for this feature because it stops edits before the filesystem tool runs while still allowing a UI confirmation flow when desired.
