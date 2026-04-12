# `@cmc/pi-skillpacks`

A Pi package that adds `/skillpack-add <path>`, `/skillpack-remove <path>`, and `/skillpacks` so you can load and unload skill packs from `~/.pi/agent/skillpacks` for the current session.

## Install

### Local development

```bash
mise install
bun install
bun test
bun run check
pi install /absolute/path/to/pi-packages/packages/pi-skillpacks
```

### Install as a Pi package

```bash
pi install npm:@cmc/pi-skillpacks
```

## Skill pack layout

```text
~/.pi/agent/skillpacks/
  superpowers/
    agent-browser/
      SKILL.md
      templates/
    planner/
      SKILL.md
```

Skills are loaded from their original directories, so files next to `SKILL.md` keep working.

## Commands

- `/skillpack-add superpowers`
- `/skillpack-add superpowers/agent-browser`
- `/skillpack-remove superpowers`
- `/skillpacks`

`/skillpacks` opens an interactive browser with search, per-skillpack/per-skill toggles on spacebar, Enter and left/right collapse/expand for sections, Esc to apply changes, Ctrl+C to cancel, and a detail pane for the currently selected row.

Selections persist in the current session history. Overlapping selections use union semantics, so removing a nested path will not unload a skill that is still covered by a parent selection.
