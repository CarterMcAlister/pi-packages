import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../index.ts', import.meta.url),
  'utf-8',
).replaceAll("'", '"')

test('stash shortcut supports macOS Option+S character input', () => {
  assert.match(source, /function isStashShortcutInput\(data: string\): boolean/)
  assert.match(source, /data === "ß"/)
  assert.match(source, /data === "\\x1bs"/)
  assert.match(source, /data === "\\x1bS"/)
  assert.match(source, /27;3;115/)
  assert.match(source, /matchesKey\(data, "alt\+s" as never\)/)
  assert.match(source, /pi\.registerShortcut\("alt\+s" as never/)
  assert.match(source, /ctx\.ui\.onTerminalInput\(\(data: string\) =>/)
  assert.match(source, /if \(isStashShortcutInput\(data\)\)/)
  assert.match(source, /stashOrRestoreEditorText\(ctx\)/)
  assert.match(source, /return \{ consume: true \}/)
  assert.doesNotMatch(source, /data === "\\x1b\\b"/)
  assert.doesNotMatch(source, /data === "\\x1b\\x7f"/)
})

test('prompt history shortcut has terminal-input fallback routing', () => {
  assert.match(
    source,
    /function isPromptHistoryShortcutInput\(data: string\): boolean/,
  )
  assert.match(
    source,
    /matchesConfiguredShortcut\(data, resolvedShortcuts\.stashHistory\)/,
  )
  assert.match(source, /104\(\?:/)
  assert.match(source, /27;7;104/)
  assert.match(source, /return \{ kind: "stashHistory" \}/)
  assert.match(source, /void openStashHistory\(ctx\)/)
})
