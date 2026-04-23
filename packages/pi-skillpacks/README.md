# `@carter-mcalister/pi-skillpacks`

A Pi package that adds `/skillpacks`, `/skillpacks:install <owner/repo>`, and `/skillpacks:search <query>` so you can browse, discover, install, and enable skill packs from `~/.pi/agent/skillpacks`.

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
pi install npm:@carter-mcalister/pi-skillpacks
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

- `/skillpacks`
- `/skillpacks:install obra/superpowers`
- `/skillpacks:search planner`

`/skillpacks` opens an interactive browser with search, per-skillpack/per-skill toggles on spacebar, Enter and left/right collapse/expand for sections, Esc to apply changes, Ctrl+C to cancel, and a detail pane for the currently selected row.

`/skillpacks:install` installs every discovered skill from a GitHub repository into a single local skillpack directory such as `~/.pi/agent/skillpacks/obra-superpowers`, enables that skillpack for the current session, and reloads Pi with polished progress updates while the install is running.

`/skillpacks:search` runs `gh skill search --json ...`, shows matching repositories in the Pi UI, lets you choose one, and then installs and enables that repository as a local skillpack.

Selections persist in the current session history. Overlapping selections use union semantics, so removing a nested path will not unload a skill that is still covered by a parent selection.
