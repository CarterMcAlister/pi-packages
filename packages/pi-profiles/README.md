# `@carter-mcalister/pi-profiles`

Session-scoped profile loader for Pi.

`pi-profiles` lets you define reusable profiles with standard Pi-style `settings.json` files, load one into the current session, and reload Pi so the profile’s resources and settings apply.

It is designed to build on skillpacks:

- standard Pi resources come from profile `settings.json`
- skillpack-backed skills come from a profile-specific `skillpacks` array
- loading a profile persists the choice in the current session and reloads Pi
- profile settings are overlaid onto the current session as effective project settings

## Install

### Local development

```bash
mise install
bun install
bun test
bun run check
pi install /absolute/path/to/pi-packages/packages/pi-profiles
```

### Install as a Pi package

```bash
pi install npm:@carter-mcalister/pi-profiles
```

## Profile layout

Profiles live in either:

- global: `~/.pi/agent/profiles/<name>/settings.json`
- project: `.pi/profiles/<name>/settings.json`

Project profiles win over global profiles when the same name exists in both places.

## Commands

- `/profiles` — open the profiles UI
- `/profiles <name>` — load a profile directly
- `/profiles none` — unload the active profile

Inside the `/profiles` UI:

- `n` creates a new profile
- `e` opens the currently selected profile `settings.json` in your external editor

Names can be scoped explicitly:

- `user:default`
- `project:review`

If no scope is given, project profiles are preferred over global profiles.

## Profile format

Each profile is a directory with a `settings.json` file.

Example:

```json
{
  "description": "General-purpose project workflow with reviewer tools",
  "packages": [
    "npm:@carter-mcalister/pi-worktrunk"
  ],
  "extensions": [
    "./extensions"
  ],
  "prompts": [
    "./prompts"
  ],
  "themes": [
    "./themes"
  ],
  "skillpacks": [
    "superpowers",
    {
      "path": "helpers",
      "skills": ["reviewer"]
    },
    "legacy-pack/planner"
  ],
  "theme": "dark",
  "defaultThinkingLevel": "high",
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-20250514",
  "mcps": [
    "filesystem"
  ],
  "mcpServers": {
    "filesystem": {
      "command": "uvx",
      "args": ["mcp-server-filesystem"]
    }
  }
}
```

## Behavior

### Resource loading

`pi-profiles` loads profile resources from the profile `settings.json` using normal Pi resource fields:

- `packages`
- `extensions`
- `skills`
- `prompts`
- `themes`

It also supports:

- `skillpacks` (custom field, resolved from `~/.pi/agent/skillpacks`)

If `description` is set, the `/profiles` picker shows it instead of the raw `settings.json` path.

`skillpacks` entries can be either:

- a string like `"superpowers"` to include an entire skillpack
- a string like `"helpers/reviewer"` to include one nested skill directly
- an object like `{ "path": "helpers", "skills": ["reviewer", "planner"] }` to include selected skills from a skillpack explicitly

Relative paths in a profile resolve relative to that profile directory.

### Settings overlay

When a profile is active, its `settings.json` is merged into the current session as an effective project-scoped settings overlay.

That means:

- standard Pi config fields from the profile become visible through Pi’s settings machinery after reload
- custom fields are preserved and passed through as effective project settings
- MCP-style fields such as `mcps` or `mcpServers` are carried through for extensions or integrations that read Pi settings

For resource arrays, profile loading is additive for the current session:

- `packages`
- `extensions`
- `skills`
- `prompts`
- `themes`
- `mcps`

Other config values override the effective session settings in the normal Pi way.

### Runtime application

For settings Pi exposes runtime APIs for, `pi-profiles` applies them directly on session start/reload:

- `theme`
- `defaultThinkingLevel`
- `defaultProvider` + `defaultModel`

Other settings flow through the session settings overlay and are available to Pi subsystems and extensions that consult Pi settings after reload.

## Notes

- `skillpacks` is the only built-in custom field. Everything else should follow normal Pi `settings.json` semantics.
- Loading or unloading a profile always reloads the current session.
- Creating a profile from the UI writes a starter `settings.json` and keeps the picker open.
- Profile selection is session-scoped.
- Profile extensions are bootstrapped before reload finishes so their normal Pi lifecycle hooks can participate.
- MCP loading depends on the MCP-capable runtime or extension you use. `pi-profiles` passes MCP-style config through the effective Pi settings overlay; it does not implement an MCP client by itself.

## Development

```bash
mise install
bun install
mise run check
```
