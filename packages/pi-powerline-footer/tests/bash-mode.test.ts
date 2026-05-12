// @ts-nocheck
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  BashAutocompleteProvider,
  BashCompletionEngine,
  getOneOffBashCommandContext,
  ModeAwareAutocompleteProvider,
  OneOffBashAutocompleteProvider,
} from '../bash-mode/completion.ts'
import {
  appendProjectHistory,
  matchHistoryEntries,
  readGlobalShellHistory,
} from '../bash-mode/history.ts'
import { ManagedShellSession } from '../bash-mode/shell-session.ts'
import { BashTranscriptStore } from '../bash-mode/transcript.ts'
import { getIcons } from '../icons.ts'

function getMethod(
  target: object,
  name: string,
): (...args: unknown[]) => unknown {
  const method = Reflect.get(target, name)
  if (typeof method !== 'function') {
    throw new Error(`Expected ${name} to be a function`)
  }
  return method as (...args: unknown[]) => unknown
}

function ensureEditorModuleLinks(): { cleanup: () => void } {
  return {
    cleanup() {},
  }
}

function findFishPath(): string | null {
  const result = spawnSync('sh', ['-lc', 'command -v fish'], {
    encoding: 'utf8',
  })
  const fishPath = result.stdout.trim().split('\n')[0]
  return fishPath || null
}

test('project history is stored newest-first and global zsh history parses histfile format', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-history-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile

  appendProjectHistory(cwd, 'git status', cwd)
  appendProjectHistory(cwd, 'git stash', cwd)
  appendProjectHistory(cwd, 'git status', cwd)

  writeFileSync(
    histfile,
    [
      ': 1711111111:0;git fetch',
      ': 1711111112:0;git pull',
      'plain-command',
      '',
    ].join('\n'),
  )

  const global = readGlobalShellHistory('/bin/zsh')
  assert.deepEqual(global, ['plain-command', 'git pull', 'git fetch'])
})

test('matchHistoryEntries returns newest entries when the prefix is empty', () => {
  const matches = matchHistoryEntries(
    ['git stash', 'git status', 'git stash', 'git fetch'],
    '',
    10,
  )

  assert.deepEqual(matches, ['git stash', 'git status', 'git fetch'])
})

test('theme.json can override icons without touching colors', () => {
  const themePath = join(process.cwd(), 'theme.json')
  const originalTheme = existsSync(themePath)
    ? readFileSync(themePath, 'utf8')
    : null
  const originalNerdFonts = process.env.POWERLINE_NERD_FONTS

  try {
    writeFileSync(
      themePath,
      `${JSON.stringify({ icons: { auto: '↯', warning: '' } }, null, 2)}\n`,
    )
    process.env.POWERLINE_NERD_FONTS = '0'

    const icons = getIcons()
    assert.equal(icons.auto, '↯')
    assert.equal(icons.warning, '')
    assert.equal(icons.folder, 'dir')
  } finally {
    if (originalTheme === null) {
      if (existsSync(themePath)) unlinkSync(themePath)
    } else {
      writeFileSync(themePath, originalTheme)
    }

    if (originalNerdFonts === undefined) {
      delete process.env.POWERLINE_NERD_FONTS
    } else {
      process.env.POWERLINE_NERD_FONTS = originalNerdFonts
    }
  }
})

test('one-off bash command context strips ! and !! prefixes', () => {
  assert.deepEqual(getOneOffBashCommandContext('!git status'), {
    prefix: '!',
    command: 'git status',
    offset: 1,
  })

  assert.deepEqual(getOneOffBashCommandContext('!!git status'), {
    prefix: '!!',
    command: 'git status',
    offset: 2,
  })

  assert.equal(getOneOffBashCommandContext('  !!git status'), null)
  assert.equal(getOneOffBashCommandContext('git status'), null)
})

test('transcript store truncates oldest commands at command boundaries', () => {
  const store = new BashTranscriptStore({
    transcriptMaxLines: 3,
    transcriptMaxBytes: 1024,
  })
  store.startCommand('a', 'echo one', '/tmp')
  store.appendOutput('a', 'line-1\nline-2')
  store.finishCommand('a', 0)

  store.startCommand('b', 'echo two', '/tmp')
  store.appendOutput('b', 'line-3\nline-4')
  store.finishCommand('b', 0)

  const snapshot = store.getSnapshot()
  assert.equal(snapshot.commands.length, 1)
  assert.equal(snapshot.commands[0]?.id, 'b')
  assert.equal(snapshot.truncatedCommands, 1)
})

test('transcript store keeps the active command even when it alone exceeds limits', () => {
  const store = new BashTranscriptStore({
    transcriptMaxLines: 3,
    transcriptMaxBytes: 1024,
  })
  store.startCommand('a', 'echo big', '/tmp')
  store.appendOutput('a', '1\n2\n3\n4')

  const snapshot = store.getSnapshot()
  assert.equal(snapshot.commands.length, 1)
  assert.equal(snapshot.commands[0]?.id, 'a')
  assert.deepEqual(snapshot.commands[0]?.output, ['1', '2', '3', '4'])
})

test('ghost suggestion prefers project history over global history', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-ghost-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, ': 1711111111:0;git switch\n')
  appendProjectHistory(cwd, 'git status', cwd)
  appendProjectHistory(cwd, 'git stash', cwd)

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'git st',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'git stash')
  assert.equal(suggestion?.source, 'project-history')
})

test('ghost suggestion shows newest project history on an empty prompt', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-empty-project-ghost-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, ': 1711111111:0;git pull\n')
  appendProjectHistory(cwd, 'git status', cwd)
  appendProjectHistory(cwd, 'git stash', cwd)

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    '',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'git stash')
  assert.equal(suggestion?.source, 'project-history')
})

test('ghost suggestion stays empty on an empty prompt when only global history exists', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-empty-global-ghost-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(
    histfile,
    [': 1711111111:0;git fetch', ': 1711111112:0;git pull'].join('\n'),
  )

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    '',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion, null)
})

test('ghost suggestion stays empty when the prompt is empty and no history exists', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-empty-no-history-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, '')

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    '',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion, null)
})

test('ghost suggestion can extend the current token from deterministic path completions', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-inline-ghost-'))
  mkdirSync(join(cwd, 'dev'), { recursive: true })
  mkdirSync(join(cwd, 'My Folder'), { recursive: true })

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'cd d',
    cwd,
    '/bin/sh',
    new AbortController().signal,
  )
  const escapedSuggestion = await engine.getGhostSuggestion(
    'cd M',
    cwd,
    '/bin/sh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'cd dev/')
  assert.equal(suggestion?.source, 'path')
  assert.equal(escapedSuggestion?.value, 'cd My\\ Folder/')
  assert.equal(escapedSuggestion?.source, 'path')
})

test('ghost suggestion does not invoke shell-native completion hooks', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-no-native-ghost-'))
  mkdirSync(join(cwd, 'dev'), { recursive: true })

  const engine = new BashCompletionEngine()
  Reflect.set(engine, 'getNativeSuggestions', async () => {
    throw new Error('native completion should stay disabled')
  })

  const suggestion = await engine.getGhostSuggestion(
    'cd d',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'cd dev/')
  assert.equal(suggestion?.source, 'path')
})

test('command-position ghost prefers the newest successful project-history command', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-command-project-history-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, '')
  appendProjectHistory(cwd, 'git status', cwd)

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'g',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'git status')
  assert.equal(suggestion?.source, 'project-history')
})

test('command-position ghost uses guarded global git history when project history is absent', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-command-global-history-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, ': 1711111111:0;git stash\n')

  const engine = new BashCompletionEngine()
  const shortStemSuggestion = await engine.getGhostSuggestion(
    'g',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )
  const guardedSuggestion = await engine.getGhostSuggestion(
    'gi',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(shortStemSuggestion?.value, 'git status')
  assert.equal(shortStemSuggestion?.source, 'git')
  assert.equal(guardedSuggestion?.value, 'git stash')
  assert.equal(guardedSuggestion?.source, 'global-history')
})

test('command-position ghost falls back to git status when git is likely but history is absent', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-command-git-default-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, '')

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'g',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'git status')
  assert.equal(suggestion?.source, 'git')
})

test('command-position ghost falls back to cd dot-dot for the cd stem', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-command-cd-default-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, '')

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'c',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'cd ..')
  assert.equal(suggestion?.source, 'path')
})

test('command-position ghost stays empty when there is no supported history-backed stem', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-command-empty-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, '')

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'x',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion, null)
})

test('ghost suggestion ignores invalid raw global history and keeps a deterministic git candidate', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-global-history-ghost-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, ': 1711111111:0;git statis\n')

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'git st',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.match(suggestion?.value ?? '', /^git sta(?:sh|tus)$/)
  assert.equal(suggestion?.source, 'git')
})

test('global history boosts already-valid deterministic git candidates', async () => {
  const cwd = mkdtempSync(
    join(tmpdir(), 'powerline-global-history-tiebreak-ghost-'),
  )
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, ': 1711111111:0;git stash\n')

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'git st',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'git stash')
  assert.equal(suggestion?.source, 'git')
})

test('deterministic path completion keeps directory suffixes for escaped paths', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-path-escaped-'))
  const histfile = join(cwd, '.zsh_history')
  process.env.HISTFILE = histfile
  writeFileSync(histfile, '')
  mkdirSync(join(cwd, 'My Folder'), { recursive: true })

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'cd M',
    cwd,
    '/bin/zsh',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'cd My\\ Folder/')
  assert.equal(suggestion?.source, 'path')
})

test('deterministic path completion handles bash argument position', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-bash-path-'))
  mkdirSync(join(cwd, 'devdir'), { recursive: true })

  const engine = new BashCompletionEngine()
  const suggestion = await engine.getGhostSuggestion(
    'cd d',
    cwd,
    '/bin/bash',
    new AbortController().signal,
  )

  assert.equal(suggestion?.value, 'cd devdir/')
  assert.equal(suggestion?.source, 'path')
})

test('managed shell session preserves cwd changes across commands', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-shell-'))
  const childDir = join(cwd, 'child:with-colon')
  mkdirSync(childDir, { recursive: true })
  const store = new BashTranscriptStore({
    transcriptMaxLines: 100,
    transcriptMaxBytes: 64 * 1024,
  })
  const cwdChanges: string[] = []
  const session = new ManagedShellSession(
    '/bin/zsh',
    cwd,
    store,
    () => {},
    () => {},
    (nextCwd) => cwdChanges.push(nextCwd),
  )

  try {
    await session.ensureReady()
    await session.runCommand(`cd ${childDir}`)
    const waitForCommand = async () => {
      const start = Date.now()
      while (session.state.running && Date.now() - start < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      assert.equal(session.state.running, false)
    }

    await waitForCommand()
    assert.equal(session.state.cwd, childDir)
    assert.equal(cwdChanges.at(-1), childDir)

    await session.runCommand('pwd')
    await waitForCommand()

    const snapshot = store.getSnapshot()
    const lastCommand = snapshot.commands[snapshot.commands.length - 1]
    assert.ok(lastCommand?.output.includes(childDir))
  } finally {
    session.dispose()
  }
})

test('managed shell session recovers cleanly after interrupt', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'powerline-shell-interrupt-'))
  const store = new BashTranscriptStore({
    transcriptMaxLines: 100,
    transcriptMaxBytes: 64 * 1024,
  })
  const session = new ManagedShellSession(
    '/bin/zsh',
    cwd,
    store,
    () => {},
    () => {},
  )

  const waitForCommand = async () => {
    const start = Date.now()
    while (session.state.running && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(session.state.running, false)
  }

  try {
    await session.ensureReady()
    await session.runCommand('sleep 5')
    await new Promise((resolve) => setTimeout(resolve, 100))
    session.interrupt()
    await waitForCommand()

    const interruptedCommand = store.getSnapshot().commands[0]
    assert.equal(interruptedCommand?.exitCode, 130)

    await session.runCommand("printf 'after\\n'")
    await waitForCommand()

    const snapshot = store.getSnapshot()
    const lastCommand = snapshot.commands[snapshot.commands.length - 1]
    assert.equal(lastCommand?.command, "printf 'after\\n'")
    assert.equal(lastCommand?.exitCode, 0)
    assert.ok(lastCommand?.output.includes('after'))
  } finally {
    session.dispose()
  }
})

test('managed fish shell session runs commands without waiting for stdin EOF', async (t) => {
  const fishPath = findFishPath()
  if (!fishPath) return t.skip('fish is not installed')

  const cwd = mkdtempSync(join(tmpdir(), 'powerline-fish-shell-'))
  const childDir = join(cwd, 'child')
  mkdirSync(childDir, { recursive: true })
  writeFileSync(join(childDir, 'alpha.txt'), '')
  const store = new BashTranscriptStore({
    transcriptMaxLines: 100,
    transcriptMaxBytes: 64 * 1024,
  })
  const session = new ManagedShellSession(
    fishPath,
    cwd,
    store,
    () => {},
    () => {},
  )

  const waitForCommand = async () => {
    const start = Date.now()
    while (session.state.running && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(session.state.running, false)
  }

  try {
    await session.ensureReady()
    await session.runCommand(`cd ${childDir}`)
    await waitForCommand()
    assert.equal(realpathSync(session.state.cwd), realpathSync(childDir))

    await session.runCommand('pwd')
    await waitForCommand()
    await session.runCommand('ls')
    await waitForCommand()
    await session.runCommand('if test -t 1; echo tty; else echo pipe; end')
    await waitForCommand()

    const snapshot = store.getSnapshot()
    const pwdCommand = snapshot.commands.find(
      (entry) => entry.command === 'pwd',
    )
    const lsCommand = snapshot.commands.find((entry) => entry.command === 'ls')
    const ttyCommand = snapshot.commands.find((entry) =>
      entry.command.startsWith('if test -t 1'),
    )
    assert.equal(pwdCommand?.exitCode, 0)
    assert.equal(
      realpathSync(pwdCommand?.output[0] ?? ''),
      realpathSync(childDir),
    )
    assert.equal(lsCommand?.exitCode, 0)
    assert.ok(lsCommand?.output.some((line) => line.includes('alpha.txt')))
    assert.equal(ttyCommand?.exitCode, 0)
    assert.ok(ttyCommand?.output.includes('tty'))
  } finally {
    session.dispose()
  }
})

test('managed fish shell session recovers cleanly after interrupt', async (t) => {
  const fishPath = findFishPath()
  if (!fishPath) return t.skip('fish is not installed')

  const cwd = mkdtempSync(join(tmpdir(), 'powerline-fish-interrupt-'))
  const store = new BashTranscriptStore({
    transcriptMaxLines: 100,
    transcriptMaxBytes: 64 * 1024,
  })
  const session = new ManagedShellSession(
    fishPath,
    cwd,
    store,
    () => {},
    () => {},
  )

  const waitForCommand = async () => {
    const start = Date.now()
    while (session.state.running && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(session.state.running, false)
  }

  try {
    await session.ensureReady()
    await session.runCommand('sleep 10')
    await new Promise((resolve) => setTimeout(resolve, 100))
    session.interrupt()
    await waitForCommand()

    const interruptedCommand = store.getSnapshot().commands[0]
    assert.equal(interruptedCommand?.exitCode, 130)

    await session.runCommand('echo after')
    await waitForCommand()

    const snapshot = store.getSnapshot()
    const lastCommand = snapshot.commands[snapshot.commands.length - 1]
    assert.equal(lastCommand?.exitCode, 0)
    assert.ok(lastCommand?.output.includes('after'))
  } finally {
    session.dispose()
  }
})

test('managed fish shell session preserves safe ANSI styling in output', async (t) => {
  const fishPath = findFishPath()
  if (!fishPath) return t.skip('fish is not installed')

  const cwd = mkdtempSync(join(tmpdir(), 'powerline-fish-color-'))
  const store = new BashTranscriptStore({
    transcriptMaxLines: 100,
    transcriptMaxBytes: 64 * 1024,
  })
  const session = new ManagedShellSession(
    fishPath,
    cwd,
    store,
    () => {},
    () => {},
  )

  const waitForCommand = async () => {
    const start = Date.now()
    while (session.state.running && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(session.state.running, false)
  }

  try {
    await session.ensureReady()
    await session.runCommand("printf '\\e[31mred\\e[0m\\n'")
    await waitForCommand()

    const snapshot = store.getSnapshot()
    const lastCommand = snapshot.commands[snapshot.commands.length - 1]
    assert.equal(lastCommand?.exitCode, 0)
    assert.ok(lastCommand?.output.includes('\x1b[31mred\x1b[0m'))
  } finally {
    session.dispose()
  }
})

test('managed fish shell session preserves persistent shell state between commands', async (t) => {
  const fishPath = findFishPath()
  if (!fishPath) return t.skip('fish is not installed')

  const cwd = mkdtempSync(join(tmpdir(), 'powerline-fish-env-'))
  const store = new BashTranscriptStore({
    transcriptMaxLines: 100,
    transcriptMaxBytes: 64 * 1024,
  })
  const session = new ManagedShellSession(
    fishPath,
    cwd,
    store,
    () => {},
    () => {},
  )

  const waitForCommand = async () => {
    const start = Date.now()
    while (session.state.running && Date.now() - start < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(session.state.running, false)
  }

  try {
    await session.ensureReady()
    await session.runCommand('set -gx PI_POWERLINE_FISH_TEST exported')
    await waitForCommand()
    await session.runCommand('set -g pi_powerline_fish_global global')
    await waitForCommand()
    await session.runCommand('function pi_powerline_hi; echo function-ok; end')
    await waitForCommand()

    await session.runCommand(
      'echo $PI_POWERLINE_FISH_TEST $pi_powerline_fish_global; pi_powerline_hi',
    )
    await waitForCommand()

    const snapshot = store.getSnapshot()
    const lastCommand = snapshot.commands[snapshot.commands.length - 1]
    assert.equal(lastCommand?.exitCode, 0)
    assert.ok(lastCommand?.output.includes('exported global'))
    assert.ok(lastCommand?.output.includes('function-ok'))
  } finally {
    session.dispose()
  }
})

test('bash editor Tab accepts the current ghost suggestion without opening autocomplete', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let accepted = false

    getMethod(BashModeEditor.prototype, 'handleInput').call(
      {
        optionsRef: {
          isBashModeActive: () => true,
          isShellRunning: () => false,
          onExitBashMode() {},
          onInterrupt() {},
          onNotify() {},
          onSubmitCommand() {},
        },
        keybindingsRef: {
          matches(_data: string, id: string) {
            return id === 'tui.input.tab'
          },
        },
        isShowingAutocomplete() {
          return false
        },
        acceptGhostSuggestion() {
          accepted = true
          return true
        },
      },
      'tab',
    )

    assert.equal(accepted, true)
  } finally {
    links.cleanup()
  }
})

test('bash editor does not submit pasted multiline input while bracketed paste is active', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const { CustomEditor } = await import('@earendil-works/pi-coding-agent')

    let delegated = 0
    let submitted = 0
    const superHandleInput = CustomEditor.prototype.handleInput
    CustomEditor.prototype.handleInput = function handleInput() {
      delegated += 1
    }

    try {
      getMethod(BashModeEditor.prototype, 'handleInput').call(
        {
          isInPaste: true,
          optionsRef: {
            isBashModeActive: () => true,
            isShellRunning: () => false,
            onExitBashMode() {},
            onInterrupt() {},
            onNotify() {},
            onSubmitCommand() {
              submitted += 1
            },
            getHistoryEntries() {
              return []
            },
            resolveGhostSuggestion: async () => null,
          },
          keybindingsRef: {
            matches(data: string, id: string) {
              return data === '\r' && id === 'tui.input.submit'
            },
          },
        },
        '\r',
      )
    } finally {
      CustomEditor.prototype.handleInput = superHandleInput
    }

    assert.equal(submitted, 0)
    assert.equal(delegated, 1)
  } finally {
    links.cleanup()
  }
})

test('bash editor refreshes shell ghost state after a bracketed paste completes', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const { CustomEditor } = await import('@earendil-works/pi-coding-agent')

    let delegated = 0
    let scheduled = 0
    const superHandleInput = CustomEditor.prototype.handleInput
    CustomEditor.prototype.handleInput = function handleInput() {
      delegated += 1
      Reflect.set(this, 'isInPaste', false)
    }

    try {
      getMethod(BashModeEditor.prototype, 'handleInput').call(
        {
          isInPaste: true,
          optionsRef: {
            isBashModeActive: () => true,
            isShellRunning: () => false,
            onExitBashMode() {},
            onInterrupt() {},
            onNotify() {},
            onSubmitCommand() {},
            getHistoryEntries() {
              return []
            },
            resolveGhostSuggestion: async () => null,
          },
          keybindingsRef: {
            matches() {
              return false
            },
          },
          getExpandedText() {
            return 'git status'
          },
          isShellCompletionContext() {
            return true
          },
          shellHistoryIndex: 3,
          shellHistoryItems: ['git status'],
          shellHistoryDraft: 'git',
          scheduleGhostUpdate() {
            scheduled += 1
          },
        },
        '\r',
      )
    } finally {
      CustomEditor.prototype.handleInput = superHandleInput
    }

    assert.equal(delegated, 1)
    assert.equal(scheduled, 1)
  } finally {
    links.cleanup()
  }
})

test('one-off bash autocomplete provider stays inactive even inside bang commands', async () => {
  const provider = new OneOffBashAutocompleteProvider()
  const suggestions = await provider.getSuggestions(['!!gi'], 0, 4, {
    signal: new AbortController().signal,
  })

  assert.equal(suggestions, null)
})

test('bash autocomplete providers return null in shell contexts', async () => {
  const signal = new AbortController().signal

  const bashSuggestions = await new BashAutocompleteProvider().getSuggestions(
    ['git st'],
    0,
    6,
    { signal },
  )
  const oneOffSuggestions =
    await new OneOffBashAutocompleteProvider().getSuggestions(
      ['!git st'],
      0,
      7,
      { signal },
    )

  assert.equal(bashSuggestions, null)
  assert.equal(oneOffSuggestions, null)
})

test('mode-aware autocomplete provider preserves default results', async () => {
  const signal = new AbortController().signal
  const syncResult = {
    items: [{ value: 'status', label: 'status' }],
    prefix: 'st',
  }
  const provider = new ModeAwareAutocompleteProvider(
    {
      async getSuggestions() {
        return syncResult
      },
      applyCompletion(lines: string[], cursorLine: number, cursorCol: number) {
        return { lines, cursorLine, cursorCol }
      },
    },
    new BashAutocompleteProvider(),
    new OneOffBashAutocompleteProvider(),
    () => false,
  )

  const suggestions = await provider.getSuggestions(['st'], 0, 2, { signal })

  assert.equal(suggestions, syncResult)
})

test('one-off bash autocomplete provider stays inactive before the bang command starts', async () => {
  const provider = new OneOffBashAutocompleteProvider()

  assert.equal(
    provider.shouldTriggerFileCompletion(['!git status'], 0, 0),
    false,
  )
  assert.equal(
    await provider.getSuggestions(['!git status'], 0, 0, {
      signal: new AbortController().signal,
    }),
    null,
  )
})

test('bash editor refreshGhostSuggestion reuses the ghost scheduling path', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let scheduled = false

    getMethod(BashModeEditor.prototype, 'refreshGhostSuggestion').call({
      scheduleGhostUpdate() {
        scheduled = true
      },
    })

    assert.equal(scheduled, true)
  } finally {
    links.cleanup()
  }
})

test('bash editor dismiss clears autocomplete when mode turns off', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let aborted = false
    let cancelled = false
    let rendered = false
    const fakeAbort = {
      abort() {
        aborted = true
      },
    }
    const fakeEditor = {
      historyIndex: 7,
      shellHistoryIndex: 2,
      shellHistoryItems: ['git status'],
      shellHistoryDraft: 'git st',
      ghostAbort: fakeAbort,
      ghost: { value: 'git status', source: 'project-history' },
      clearGhostSuggestion() {
        this.ghostAbort?.abort()
        this.ghostAbort = null
        this.ghost = null
      },
      cancelAutocomplete() {
        cancelled = true
      },
      tui: {
        requestRender() {
          rendered = true
        },
      },
    }

    getMethod(BashModeEditor.prototype, 'dismissBashModeUi').call(fakeEditor)

    assert.equal(aborted, true)
    assert.equal(cancelled, true)
    assert.equal(rendered, true)
    assert.equal(fakeEditor.historyIndex, 7)
    assert.equal(fakeEditor.shellHistoryIndex, -1)
  } finally {
    links.cleanup()
  }
})

test('bash editor shell history state does not clobber the base prompt history index', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const fakeEditor = {
      historyIndex: 5,
      shellHistoryIndex: -1,
      shellHistoryItems: [],
      shellHistoryDraft: '',
      ghostAbort: null,
      ghost: null,
      optionsRef: {
        getHistoryEntries: () => ['git stash', 'git status'],
        onNotify: () => {},
      },
      getExpandedText() {
        return 'git st'
      },
      setText() {},
      clearGhostSuggestion() {},
      scheduleGhostUpdate() {},
    }

    getMethod(BashModeEditor.prototype, 'navigateShellHistory').call(
      fakeEditor,
      -1,
    )

    assert.equal(fakeEditor.historyIndex, 5)
    assert.equal(fakeEditor.shellHistoryIndex, 0)
  } finally {
    links.cleanup()
  }
})

test('bash editor escape exits bash mode', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let exited = false
    let interrupted = false

    getMethod(BashModeEditor.prototype, 'handleInput').call(
      {
        optionsRef: {
          isBashModeActive: () => true,
          onExitBashMode: () => {
            exited = true
          },
          isShellRunning: () => false,
          onInterrupt: () => {
            interrupted = true
          },
        },
        keybindingsRef: {
          matches(data: string, id: string) {
            return data === 'escape' && id === 'app.interrupt'
          },
        },
      },
      'escape',
    )

    assert.equal(exited, true)
    assert.equal(interrupted, false)
  } finally {
    links.cleanup()
  }
})

test('bash editor right arrow accepts an empty-prompt ghost suggestion without submitting', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let accepted = false
    let submitted = false

    getMethod(BashModeEditor.prototype, 'handleInput').call(
      {
        optionsRef: {
          isBashModeActive: () => true,
          isShellRunning: () => false,
          onExitBashMode: () => {},
          onSubmitCommand: () => {
            submitted = true
          },
          onInterrupt: () => {},
          onNotify: () => {},
        },
        keybindingsRef: {
          matches(data: string, id: string) {
            return data === 'right' && id === 'tui.editor.cursorRight'
          },
        },
        isShowingAutocomplete() {
          return false
        },
        acceptGhostSuggestion() {
          accepted = true
          return true
        },
      },
      'right',
    )

    assert.equal(accepted, true)
    assert.equal(submitted, false)
  } finally {
    links.cleanup()
  }
})

test('bash editor right arrow accepts ghost text for one-off bang commands', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let accepted = false

    getMethod(BashModeEditor.prototype, 'handleInput').call(
      {
        optionsRef: {
          isBashModeActive: () => false,
        },
        keybindingsRef: {
          matches(data: string, id: string) {
            return data === 'right' && id === 'tui.editor.cursorRight'
          },
        },
        getExpandedText() {
          return '!git st'
        },
        isOneOffBashCommandContext() {
          return true
        },
        acceptGhostSuggestion() {
          accepted = true
          return true
        },
      },
      'right',
    )

    assert.equal(accepted, true)
  } finally {
    links.cleanup()
  }
})

test('bash editor runs copied Pi app action handlers for alt-enter', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const { setKittyProtocolActive } = await import('@earendil-works/pi-tui')
    const keybindings = {
      matches(data: string, id: string) {
        return (
          id === 'app.message.followUp' &&
          (data === '\x1b\r' || data === '\x1b[13;3u')
        )
      },
      getKeys() {
        return []
      },
      getDefinition() {
        return { description: '', defaultKeys: [] }
      },
    }
    const editor = new BashModeEditor(
      { requestRender() {}, terminal: { columns: 80, rows: 24 } },
      {},
      keybindings,
      {
        keybindings,
        isBashModeActive: () => false,
        isShellRunning: () => false,
        onExitBashMode() {},
        onSubmitCommand() {},
        onInterrupt() {},
        onNotify() {},
        getHistoryEntries: () => [],
        resolveGhostSuggestion: async () => null,
      },
    )

    let handled = 0
    editor.actionHandlers.set('app.message.followUp', () => {
      handled += 1
    })

    try {
      setKittyProtocolActive(false)
      editor.handleInput('\x1b\r')
      assert.equal(handled, 1)

      setKittyProtocolActive(true)
      editor.handleInput('\x1b[13;3u')
      assert.equal(handled, 2)
    } finally {
      setKittyProtocolActive(false)
    }
  } finally {
    links.cleanup()
  }
})

test('bash editor command arrows jump to editor boundaries', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const { KeybindingsManager, TUI_KEYBINDINGS } = await import(
      '@earendil-works/pi-tui'
    )
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS)
    let renderRequests = 0
    const editor = new BashModeEditor(
      {
        requestRender() {
          renderRequests += 1
        },
        terminal: { columns: 80, rows: 24 },
      },
      {},
      keybindings,
      {
        keybindings,
        isBashModeActive: () => false,
        isShellRunning: () => false,
        onExitBashMode() {},
        onSubmitCommand() {},
        onInterrupt() {},
        onNotify() {},
        getHistoryEntries: () => [],
        resolveGhostSuggestion: async () => null,
      },
    )

    editor.setText('alpha\nbravo\ncharlie')
    assert.deepEqual(editor.getCursor(), { line: 2, col: 7 })

    editor.handleInput('\x1b[A')
    assert.notDeepEqual(editor.getCursor(), { line: 0, col: 0 })
    editor.handleInput('\x1b[B')
    assert.deepEqual(editor.getCursor(), { line: 2, col: 7 })

    editor.handleInput('\x1b[1;9A')
    assert.notDeepEqual(editor.getCursor(), { line: 0, col: 0 })

    editor.handleInput('\x1b[1;10A')
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 })

    editor.handleInput('\x1b[27;10;66~')
    assert.deepEqual(editor.getCursor(), { line: 2, col: 7 })

    editor.handleInput('\x1b[27;10;65~')
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 })

    editor.handleInput('\x1b[57420;10u')
    assert.deepEqual(editor.getCursor(), { line: 2, col: 7 })

    editor.handleInput('\x1b[57423;10u')
    assert.deepEqual(editor.getCursor(), { line: 0, col: 0 })

    editor.handleInput('\x1b[1;10F')
    assert.deepEqual(editor.getCursor(), { line: 2, col: 7 })

    editor.handleInput('\x1b[1;10:3A')
    assert.deepEqual(editor.getCursor(), { line: 2, col: 7 })

    const customEditor = new BashModeEditor(
      { requestRender() {}, terminal: { columns: 80, rows: 24 } },
      {},
      keybindings,
      {
        keybindings,
        isBashModeActive: () => false,
        isShellRunning: () => false,
        onExitBashMode() {},
        onSubmitCommand() {},
        editorBoundaryShortcuts: { start: 'ctrl+shift+u', end: 'ctrl+shift+d' },
        onInterrupt() {},
        onNotify() {},
        getHistoryEntries: () => [],
        resolveGhostSuggestion: async () => null,
      },
    )
    customEditor.setText('alpha\nbravo\ncharlie')
    customEditor.handleInput('\x1b[117;6u')
    assert.deepEqual(customEditor.getCursor(), { line: 0, col: 0 })
    customEditor.handleInput('\x1b[100;6u')
    assert.deepEqual(customEditor.getCursor(), { line: 2, col: 7 })

    const configuredCommandEditor = new BashModeEditor(
      { requestRender() {}, terminal: { columns: 80, rows: 24 } },
      {},
      keybindings,
      {
        keybindings,
        isBashModeActive: () => false,
        isShellRunning: () => false,
        onExitBashMode() {},
        onSubmitCommand() {},
        editorBoundaryShortcuts: {
          start: 'super+shift+up',
          end: 'super+shift+down',
        },
        onInterrupt() {},
        onNotify() {},
        getHistoryEntries: () => [],
        resolveGhostSuggestion: async () => null,
      },
    )
    configuredCommandEditor.setText('alpha\nbravo\ncharlie')
    configuredCommandEditor.handleInput('\x1b[1;10A')
    assert.deepEqual(configuredCommandEditor.getCursor(), { line: 0, col: 0 })
    configuredCommandEditor.handleInput('\x1b[1;10B')
    assert.deepEqual(configuredCommandEditor.getCursor(), { line: 2, col: 7 })

    assert.equal(renderRequests, 6)
  } finally {
    links.cleanup()
  }
})

test('bash editor option-shift arrows select words', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const { KeybindingsManager, TUI_KEYBINDINGS } = await import(
      '@earendil-works/pi-tui'
    )
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS)
    let renderRequests = 0
    const editor = new BashModeEditor(
      {
        requestRender() {
          renderRequests += 1
        },
        terminal: { columns: 80, rows: 24 },
      },
      { borderColor: (text: string) => text, selectList: {} },
      keybindings,
      {
        keybindings,
        isBashModeActive: () => false,
        isShellRunning: () => false,
        onExitBashMode() {},
        onSubmitCommand() {},
        onInterrupt() {},
        onNotify() {},
        getHistoryEntries: () => [],
        resolveGhostSuggestion: async () => null,
      },
    )

    editor.setText('alpha beta gamma')
    editor.handleInput('\x1b[1;4D')

    assert.deepEqual(editor.getCursor(), { line: 0, col: 11 })
    assert.equal(editor.getSelectedText(), 'gamma')
    assert.ok(editor.render(40)[1]?.includes('\x1b[7mgamma\x1b[0m'))
    assert.equal(renderRequests, 1)

    editor.handleInput('\x1b[D')
    assert.equal(editor.getSelectedText(), null)
  } finally {
    links.cleanup()
  }
})

test('bash editor backspace deletes highlighted words', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const { KeybindingsManager, TUI_KEYBINDINGS } = await import(
      '@earendil-works/pi-tui'
    )
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS)
    let renderRequests = 0
    const editor = new BashModeEditor(
      {
        requestRender() {
          renderRequests += 1
        },
        terminal: { columns: 80, rows: 24 },
      },
      { borderColor: (text: string) => text, selectList: {} },
      keybindings,
      {
        keybindings,
        isBashModeActive: () => false,
        isShellRunning: () => false,
        onExitBashMode() {},
        onSubmitCommand() {},
        onInterrupt() {},
        onNotify() {},
        getHistoryEntries: () => [],
        resolveGhostSuggestion: async () => null,
      },
    )
    let changedText = ''
    editor.onChange = (text: string) => {
      changedText = text
    }

    editor.setText('alpha beta gamma')
    editor.handleInput('\x1b[1;4D')
    editor.handleInput('\x7f')

    assert.equal(editor.getText(), 'alpha beta ')
    assert.equal(changedText, 'alpha beta ')
    assert.deepEqual(editor.getCursor(), { line: 0, col: 11 })
    assert.equal(editor.getSelectedText(), null)
    assert.equal(renderRequests, 2)
  } finally {
    links.cleanup()
  }
})

test('bash editor enter does not accept ghost text while a shell command is running', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let warned = false
    let submitted = false

    getMethod(BashModeEditor.prototype, 'handleInput').call(
      {
        ghost: { value: 'git status', source: 'project-history' },
        optionsRef: {
          isBashModeActive: () => true,
          isShellRunning: () => true,
          onExitBashMode: () => {},
          onInterrupt: () => {},
          onSubmitCommand: () => {
            submitted = true
          },
          onNotify: (message: string) => {
            warned = message === 'Shell command already running'
          },
        },
        keybindingsRef: {
          matches(_data: string, id: string) {
            return id === 'tui.input.submit'
          },
        },
        getExpandedText() {
          return 'git st'
        },
        isShowingAutocomplete() {
          return false
        },
        acceptGhostSuggestion() {
          throw new Error('ghost should not be accepted while running')
        },
      },
      'enter',
    )

    assert.equal(warned, true)
    assert.equal(submitted, false)
  } finally {
    links.cleanup()
  }
})

test('bash editor enter submits the typed command without accepting ghost text', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let submittedCommand = ''

    getMethod(BashModeEditor.prototype, 'handleInput').call(
      {
        ghost: { value: 'git diff --staged', source: 'project-history' },
        optionsRef: {
          isBashModeActive: () => true,
          isShellRunning: () => false,
          onExitBashMode: () => {},
          onInterrupt: () => {},
          onNotify: () => {},
          onSubmitCommand: (command: string) => {
            submittedCommand = command
          },
        },
        keybindingsRef: {
          matches(_data: string, id: string) {
            return id === 'tui.input.submit'
          },
        },
        getExpandedText() {
          return 'git diff'
        },
        acceptGhostSuggestion() {
          throw new Error('enter should not accept ghost text')
        },
        clearGhostSuggestion() {},
        setText() {},
        refreshGhostSuggestion() {},
        shellHistoryIndex: -1,
        shellHistoryItems: [],
        shellHistoryDraft: '',
      },
      'enter',
    )

    assert.equal(submittedCommand, 'git diff')
  } finally {
    links.cleanup()
  }
})

test('one-off bang submit does not accept ghost text before submitting', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const { CustomEditor } = await import('@earendil-works/pi-coding-agent')

    let delegated = 0
    const superHandleInput = CustomEditor.prototype.handleInput
    CustomEditor.prototype.handleInput = function handleInput() {
      delegated += 1
    }

    try {
      getMethod(BashModeEditor.prototype, 'handleInput').call(
        {
          ghost: { value: '!git diff --staged', source: 'project-history' },
          optionsRef: {
            isBashModeActive: () => false,
          },
          keybindingsRef: {
            matches(_data: string, id: string) {
              return id === 'tui.input.submit'
            },
          },
          getExpandedText() {
            return '!git diff'
          },
          isOneOffBashCommandContext() {
            return true
          },
          isShellCompletionContext() {
            return true
          },
          acceptGhostSuggestion() {
            throw new Error(
              'enter should not accept ghost text for one-off bash commands',
            )
          },
        },
        'enter',
      )
    } finally {
      CustomEditor.prototype.handleInput = superHandleInput
    }

    assert.equal(delegated, 1)
  } finally {
    links.cleanup()
  }
})

test('bash editor does not accept a hidden ghost suggestion when the cursor is not at the end', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    const accepted = getMethod(
      BashModeEditor.prototype,
      'acceptGhostSuggestion',
    ).call({
      ghost: { value: 'git status', source: 'project-history' },
      getExpandedText() {
        return 'git st'
      },
      getCursor() {
        return { line: 0, col: 3 }
      },
      setText() {
        throw new Error('hidden ghost should not be accepted')
      },
      clearGhostSuggestion() {},
    })

    assert.equal(accepted, false)
  } finally {
    links.cleanup()
  }
})

test('bash editor submit clears the prompt and refreshes the empty ghost suggestion', async () => {
  const links = ensureEditorModuleLinks()

  try {
    const { BashModeEditor } = await import('../bash-mode/editor.ts')
    let submitted = false
    let cleared = false
    let refreshed = false

    getMethod(BashModeEditor.prototype, 'handleInput').call(
      {
        optionsRef: {
          isBashModeActive: () => true,
          isShellRunning: () => false,
          onExitBashMode: () => {},
          onInterrupt: () => {},
          onNotify: () => {},
          onSubmitCommand: (command: string) => {
            submitted = command === 'git status'
          },
        },
        keybindingsRef: {
          matches(_data: string, id: string) {
            return id === 'tui.input.submit'
          },
        },
        isShowingAutocomplete() {
          return false
        },
        acceptGhostSuggestion() {
          return false
        },
        getExpandedText() {
          return 'git status'
        },
        clearGhostSuggestion() {},
        setText(value: string) {
          cleared = value === ''
        },
        refreshGhostSuggestion() {
          refreshed = true
        },
        shellHistoryIndex: 3,
        shellHistoryItems: ['git status'],
        shellHistoryDraft: 'git st',
      },
      'enter',
    )

    assert.equal(submitted, true)
    assert.equal(cleared, true)
    assert.equal(refreshed, true)
  } finally {
    links.cleanup()
  }
})
