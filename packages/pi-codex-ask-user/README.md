# pi-codex-ask-user

Codex-compatible `request_user_input` extension for Pi.

It exposes the Codex-style tool surface:

- `request_user_input({ questions })`
- `questions[].id`, `header`, `question`, and `options[]`
- `options[].label` and `description`
- response text is JSON: `{ "answers": { [id]: { "answers": string[] } } }`

The UI is based on `pi-ask-user` and adds a native terminal notification when the tool is waiting for input.
