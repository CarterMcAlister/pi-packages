# pi-codex-ask-user

Codex-compatible `request_user_input` extension for Pi, backed by the richer `pi-ask-user` terminal UI.

It keeps the Codex-style tool surface:

- `request_user_input({ questions })`
- `questions[].id`, `header`, `question`, and 2-3 `options[]`
- `options[].label` and `description`
- response text is JSON: `{ "answers": { [id]: { "answers": string[] } } }`

## Features

- Sequentially asks 1-3 Codex-shaped questions and returns one aggregate JSON response
- Searchable single-select option lists with wrapped titles and descriptions
- Responsive split-pane details preview on wide terminals with single-column fallback on narrow terminals
- Freeform `None of the above` path added automatically; callers should not include an Other option
- Optional multi-select mode via Pi settings while preserving the Codex request shape
- User-toggleable extra context after structured selections; returned as `user_note: ...`
- Configurable display mode via Pi settings: `overlay` modal or `inline` in-flow rendering
- Runtime overlay toggle via configurable shortcut
- Configurable optional-comment shortcut
- Pi-TUI-aligned keybinding and editor behavior
- Optional timeout via Pi settings for custom UI and fallback dialogs
- Native terminal notification when waiting for input, plus Pi UI notification
- Structured `details` on all results for session state reconstruction
- Graceful fallback text when interactive UI is unavailable
- Bundled `ask-user` skill adapted for the Codex-compatible `request_user_input` tool

## Settings

The Codex tool shape intentionally stays compact, so UI preferences are configured in Pi `settings.json` using the `piCodexAskUser` block. Global settings live at `~/.pi/agent/settings.json`; project overrides live at `.pi/settings.json`.

```json
{
  "piCodexAskUser": {
    "displayMode": "inline",
    "overlayToggleKey": "alt+h",
    "commentToggleKey": "alt+c",
    "timeoutMs": 30000,
    "allowMultiple": false
  }
}
```

Project settings override global settings, matching Pi's normal settings behavior. Set `timeoutMs` to `null` or `0` in project settings to clear a global timeout.

## Result Notes

Structured selections return the selected labels. If the user toggles extra context, the note is appended to that question's answers as `user_note: ...`.

Choosing `None of the above` opens freeform input and returns the entered text as the answer. Because both strings have special meaning in the result shape, option labels cannot be `None of the above` or start with `user_note: `.
