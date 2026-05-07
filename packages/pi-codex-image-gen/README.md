# pi-codex-image-gen

A Pi extension that exposes a Codex-compatible `image_generation` tool.

The tool calls the hosted Codex Responses API with the native `image_generation` tool enabled, parses `image_generation_call` stream events, renders the generated image in Pi, and saves the artifact under:

```text
${CODEX_HOME:-~/.codex}/generated_images/<pi-session>/<image-id>.<format>
```

## Install

From this monorepo, include the package extension in Pi settings or install it as a Pi package once published.

```json
{
  "packages": ["npm:@carter-mcalister/pi-codex-image-gen"]
}
```

## Auth

The extension uses `openai-codex` OAuth credentials from Pi first, then falls back to Codex auth:

- `${PI_CODING_AGENT_DIR:-~/.pi/agent}/auth.json`
- `${CODEX_HOME:-~/.codex}/auth.json`

Run `/login openai-codex` in Pi if credentials are missing.

## Tool Surface

Registered tool: `image_generation`

Parameters:

- `prompt` — required image prompt; pass the user's request verbatim unless they asked for refinement.
- `images` — optional local image paths for reference/edit context.
- `model` — optional openai-codex model override.
- `output_format` — optional `png`, `jpeg`, or `webp`; defaults to `png` to match Codex.
- `timeout_ms` — optional per-call timeout override in milliseconds.

Codex native `image_generation` is a Responses API built-in rather than a JSON function tool. Pi custom tools require parameters, so this package keeps the Codex tool name, `output_format` naming, `image_generation_call` result details, and default save behavior while adding the minimal prompt/path inputs needed for Pi.

Generated image bytes are not stored in the Pi session. Tool results persist only metadata and `saved_path`; the custom renderer reads the saved file from disk transiently when drawing the image in the terminal.

## Timeout

Image requests default to a 180 second timeout. Set `PI_CODEX_IMAGE_GEN_TIMEOUT_MS` to a positive millisecond value to allow longer generations globally, or pass `timeout_ms` for a single tool call.

## Command

```text
/image-generation <prompt>
```
