# `@carter-mcalister/pi-auto-name`

English-only automatic session naming for [Pi Coding Agent](https://github.com/badlogic/pi-mono).

This package replaces `@ryan_nookpi/pi-extension-auto-name` with the same basic behavior, but it forces generated session titles to be in English.

## What it does

- Watches the first user prompt in a session
- Generates a short session title with the current model
- Forces the generated title to be English-only
- Applies the title through `pi.setSessionName()`
- Mirrors the title into the Pi status area and terminal title
- Skips subagent sessions

## Why this exists

The original package was prompting the model in Korean, which caused auto-generated session names to show up in Korean in the Pi session list and tree.

This replacement keeps the auto-naming workflow while switching the prompt and context text to English.

## Install

```bash
pi install /Users/carter/Developer/repos/pi-packages/packages/pi-auto-name
```

If Pi is already running, use `/reload` after installing the extension.

## Remove the original package

```bash
pi remove npm:@ryan_nookpi/pi-extension-auto-name
```

## Notes

- This affects session display names, not Pi compaction summaries.
- If the model or auth is unavailable when a session starts, the session will simply remain unnamed.
- Titles are intentionally short and clipped to 30 characters.

## Development

```bash
mise install
bun install
mise run check
```
