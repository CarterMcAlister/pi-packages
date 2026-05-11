# Codex Ask User Skill × Extension Spec

## Purpose

`request_user_input` provides a Codex-compatible decision gate backed by the richer `pi-ask-user` terminal UI.

The goal is to collect explicit user decisions at high-impact or ambiguous boundaries while preserving the Codex tool shape.

## Trigger Matrix

| Scenario | Must Ask? | Why |
|---|---:|---|
| Architecture trade-off | Yes | Preference-sensitive, high blast radius |
| Data schema or migration path | Yes | Costly to reverse |
| Security/compliance posture | Yes | Risk ownership is human |
| Requirements conflict or ambiguity | Yes | Need explicit intent |
| Non-trivial prioritization | Yes | Product decision, not purely technical |
| Local refactor with identical behavior | Usually no | No policy-level decision |
| Formatting-only edits | No | Trivial |
| User already gave exact decision | No | Decision already captured |

## Tool Behavior

The tool accepts 1-3 questions. Each question has:

- `id`: stable answer key
- `header`: short UI label
- `question`: one-sentence prompt
- `options`: 2-3 structured choices with `label` and `description`

The extension adds a freeform `None of the above` path, optional extra context after selection, overlay/inline UI support, overlay hide/show shortcut support, native waiting notifications, events, and structured result details. Option labels must be unique per question and cannot be `None of the above` or start with `user_note: ` because those strings have special meaning in results.

## Display Preferences

The Codex tool shape intentionally does not include display controls. Users can configure behavior in Pi `settings.json` under `piCodexAskUser`:

```json
{
  "piCodexAskUser": {
    "displayMode": "inline",
    "overlayToggleKey": "alt+o",
    "commentToggleKey": "ctrl+g",
    "timeoutMs": 30000,
    "allowMultiple": false
  }
}
```

Global settings live at `~/.pi/agent/settings.json`. Project overrides live at `.pi/settings.json` and override global values. Set `timeoutMs` to `null` or `0` in project settings to clear a global timeout.
