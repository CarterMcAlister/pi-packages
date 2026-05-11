// @ts-nocheck
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const { KEYBINDINGS } = await import(
  new URL(
    '../../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js',
    import.meta.url,
  ).href
)

import {
  isSupportedSuperShortcut,
  matchesConfiguredShortcut,
  shortcutConflictKey,
} from '../shortcuts.ts'

const source = readFileSync(
  new URL('../index.ts', import.meta.url),
  'utf-8',
).replaceAll("'", '"')

const powerlineShortcutKeys = new Set([
  'stashHistory',
  'copyEditor',
  'cutEditor',
  'jumpPreviousUserMessage',
  'jumpNextUserMessage',
  'jumpPreviousLlmMessage',
  'jumpNextLlmMessage',
  'jumpChatBottom',
  'scrollChatUp',
  'scrollChatDown',
  'editorStart',
  'editorEnd',
])

function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.trim().toLowerCase().split('+')
  if (parts.length <= 1) return parts[0] ?? ''

  const modifierRank = new Map(
    ['ctrl', 'alt', 'super', 'shift'].map((modifier, index) => [
      modifier,
      index,
    ]),
  )
  return [
    ...parts
      .slice(0, -1)
      .sort(
        (a, b) => (modifierRank.get(a) ?? 99) - (modifierRank.get(b) ?? 99),
      ),
    parts[parts.length - 1],
  ].join('+')
}

function powerlineDefaults(): Map<string, string> {
  const defaults = new Map<string, string>()
  for (const match of source.matchAll(/^ {2}([a-zA-Z0-9]+): "([^"]+)",?$/gm)) {
    const key = match[1]
    const value = match[2]
    if (key && value && powerlineShortcutKeys.has(key)) {
      defaults.set(key, value)
    }
  }
  return defaults
}

test('chat jump shortcuts are configurable and route through fixed editor scrolling', () => {
  const defaults = powerlineDefaults()
  assert.equal(defaults.get('jumpPreviousUserMessage'), 'ctrl+shift+u')
  assert.equal(defaults.get('jumpNextUserMessage'), 'ctrl+shift+i')
  assert.equal(defaults.get('jumpPreviousLlmMessage'), 'ctrl+alt+,')
  assert.equal(defaults.get('jumpNextLlmMessage'), 'ctrl+alt+.')
  assert.equal(defaults.get('jumpChatBottom'), 'ctrl+shift+g')
  assert.equal(defaults.get('scrollChatUp'), 'super+up')
  assert.equal(defaults.get('scrollChatDown'), 'super+down')
  assert.equal(defaults.get('editorStart'), 'super+shift+up')
  assert.equal(defaults.get('editorEnd'), 'super+shift+down')

  assert.match(source, /const CHAT_JUMP_SHORTCUTS:/)
  assert.match(source, /shortcutKey: "jumpPreviousUserMessage"/)
  assert.match(source, /shortcutKey: "jumpNextUserMessage"/)
  assert.match(source, /shortcutKey: "jumpPreviousLlmMessage"/)
  assert.match(source, /shortcutKey: "jumpNextLlmMessage"/)
  assert.match(source, /shortcutKey: "jumpChatBottom"/)
  assert.match(source, /resolvedShortcuts\[shortcutKey\] as never/)
  assert.match(
    source,
    /fixedEditorCompositor\.jumpToPreviousRootTarget\(targets\)/,
  )
  assert.match(source, /fixedEditorCompositor\.jumpToNextRootTarget\(targets\)/)
  assert.match(source, /fixedEditorCompositor\.jumpToRootBottom\(\)/)
  assert.match(
    source,
    /keyboardScrollShortcuts: \{[\s\S]*up: resolvedShortcuts\.scrollChatUp,[\s\S]*down: resolvedShortcuts\.scrollChatDown,/,
  )
  assert.match(
    source,
    /editorBoundaryShortcuts: \{[\s\S]*start: resolvedShortcuts\.editorStart,[\s\S]*end: resolvedShortcuts\.editorEnd,/,
  )
})

test('super shortcut matching rejects plain keys and unsupported command aliases', () => {
  assert.equal(matchesConfiguredShortcut('c', 'super+c'), false)
  assert.equal(matchesConfiguredShortcut('G', 'super+shift+g'), false)
  assert.equal(matchesConfiguredShortcut('\x1b[A', 'super+up'), false)
  assert.equal(matchesConfiguredShortcut('\x1b[1;9A', 'super+up'), true)
  assert.equal(matchesConfiguredShortcut('\x1b[1;10A', 'super+shift+up'), true)
  assert.equal(isSupportedSuperShortcut('super+c'), false)
  assert.equal(isSupportedSuperShortcut('super+shift+g'), false)
  assert.equal(isSupportedSuperShortcut('super+up'), true)
  assert.equal(shortcutConflictKey('super+home'), 'super+up')
  assert.equal(shortcutConflictKey('super+end'), 'super+down')
  assert.equal(shortcutConflictKey('super+shift+home'), 'super+shift+up')
  assert.equal(shortcutConflictKey('super+shift+end'), 'super+shift+down')
})

test('editor submits follow the fixed chat viewport to bottom', () => {
  assert.match(source, /function followSubmittedEditorToBottom\(\): void/)
  assert.match(
    source,
    /onEditorSubmit: \(\) => followSubmittedEditorToBottom\(\)/,
  )
  assert.match(source, /Object\.defineProperty\(editor, "onSubmit"/)
  assert.match(
    source,
    /followSubmittedEditorToBottom\(\)[\s\S]*handler\(text\)/,
  )
  assert.match(
    source,
    /keybindings\.matches\(\s*data,\s*"app\.message\.followUp" as never,?\s*\)/,
  )
})

test('powerline shortcut defaults do not claim reserved Pi shortcuts', () => {
  const reservedKeys = new Map<string, string>()
  for (const [id, definition] of Object.entries(KEYBINDINGS)) {
    const keys =
      definition.defaultKeys === undefined
        ? []
        : Array.isArray(definition.defaultKeys)
          ? definition.defaultKeys
          : [definition.defaultKeys]
    for (const key of keys) {
      reservedKeys.set(normalizeShortcut(key), id)
    }
  }

  for (const [name, shortcut] of powerlineDefaults()) {
    const conflict = reservedKeys.get(normalizeShortcut(shortcut))
    assert.equal(
      conflict,
      undefined,
      `${name} default ${shortcut} conflicts with ${conflict}`,
    )
  }
})

test('powerline fallback routing rejects reserved Pi shortcut defaults', () => {
  assert.doesNotMatch(source, /KeybindingsManager/)
  assert.match(source, /TUI_KEYBINDINGS/)
  assert.match(source, /const APP_RESERVED_SHORTCUTS = \[/)
  assert.match(source, /"alt\+enter"/)
  assert.match(source, /"alt\+up"/)
  assert.match(source, /"alt\+down"/)
  assert.match(source, /"ctrl\+s"/)
  assert.match(source, /"shift\+l"/)
  assert.match(
    source,
    /for \(const definition of Object\.values\(TUI_KEYBINDINGS\)\)/,
  )
  assert.doesNotMatch(source, /RESERVED_TUI_KEYBINDING_IDS/)
  assert.match(source, /const EXTRA_RESERVED_SHORTCUTS = \["alt\+s"\] as const/)
  assert.match(
    source,
    /const SHORTCUT_MODIFIER_ORDER = \["ctrl", "alt", "super", "shift"\] as const/,
  )
  assert.match(
    source,
    /const SHORTCUT_MODIFIERS = new Set<string>\(SHORTCUT_MODIFIER_ORDER\)/,
  )
  assert.match(
    source,
    /configuredToggleShortcut[\s\S]*!reservedShortcuts\(\)\.has\(shortcutUsageKey\(configuredToggleShortcut\)\)/,
  )
})

test('powerline shortcuts have terminal-input fallback routing', () => {
  assert.match(
    source,
    /function getPowerlineShortcutAction\(\s*data: string,\s*\): PowerlineShortcutAction \| null/,
  )
  assert.match(
    source,
    /matchesConfiguredShortcut\(data, resolvedShortcuts\.stashHistory\)/,
  )
  assert.match(
    source,
    /matchesConfiguredShortcut\(data, resolvedShortcuts\.copyEditor\)/,
  )
  assert.match(
    source,
    /matchesConfiguredShortcut\(data, resolvedShortcuts\.cutEditor\)/,
  )
  assert.match(
    source,
    /matchesConfiguredShortcut\(data, bashModeSettings\.toggleShortcut\)/,
  )
  assert.match(source, /runPowerlineShortcut\(ctx, powerlineShortcutAction\)/)
})

test('fixed editor shutdown cleanup resets terminal modes even before compositor install', () => {
  assert.match(source, /emergencyTerminalModeReset/)
  assert.match(source, /TerminalSplitCompositor/)
  assert.match(source, /const hadCompositor = fixedEditorCompositor !== null/)
  assert.match(
    source,
    /if \(!hadCompositor && options\?\.resetExtendedKeyboardModes\)/,
  )
  assert.match(
    source,
    /process\.stdout\.write\(emergencyTerminalModeReset\(\)\)/,
  )
})
