import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import {
  createProtectedFilesExtension,
  parseProtectedFilesConfig,
} from '../src/index'

type ToolCallHandler = (
  event: { toolName: string; input: Record<string, unknown> },
  ctx: ExtensionContext,
) => Promise<unknown>

function createFakePi() {
  let handler: ToolCallHandler | undefined
  const commands = new Map<
    string,
    { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
  >()

  const api = {
    on(eventName: string, nextHandler: ToolCallHandler) {
      if (eventName === 'tool_call') {
        handler = nextHandler
      }
    },
    registerCommand(
      name: string,
      command: {
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>
      },
    ) {
      commands.set(name, command)
    },
  } as unknown as ExtensionAPI

  return {
    api,
    commands,
    get handler() {
      if (!handler) throw new Error('tool_call handler was not registered')
      return handler
    },
  }
}

function createContext(cwd: string, confirmResult = false) {
  const notifications: Array<{ message: string; level: string }> = []
  const confirmations: Array<{ title: string; message: string }> = []

  const ctx = {
    cwd,
    hasUI: true,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level })
      },
      async confirm(title: string, message: string) {
        confirmations.push({ title, message })
        return confirmResult
      },
    },
  } as unknown as ExtensionContext

  return { ctx, notifications, confirmations }
}

async function withTempProject<T>(
  callback: (cwd: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'pi-protected-files-'))

  try {
    await mkdir(path.join(cwd, '.pi'))
    return await callback(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

test('parses string and object entries', () => {
  const config = parseProtectedFilesConfig(
    JSON.stringify({
      mode: 'confirm',
      files: ['.env', { path: 'generated/**', mode: 'block' }, ''],
    }),
  )

  expect(config).toEqual({
    mode: 'confirm',
    files: [{ path: '.env' }, { path: 'generated/**', mode: 'block' }],
    configPath: undefined,
  })
})

test('loads jsonc config files', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.jsonc'),
      `{
        // Protect env files everywhere.
        "files": [".env"]
      }`,
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx } = createContext(cwd)

    const decision = await fakePi.handler(
      { toolName: 'write', input: { path: 'app/.env' } },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason: 'Protected file: app/.env matches .env',
    })
  })
})

test('blocks write calls for matching filenames', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ files: ['package-lock.json'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx, notifications } = createContext(cwd)

    const decision = await fakePi.handler(
      { toolName: 'write', input: { path: 'subdir/package-lock.json' } },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason:
        'Protected file: subdir/package-lock.json matches package-lock.json',
    })
    expect(notifications).toHaveLength(1)
  })
})

test('disable-protections command allows protected edits for the session', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ files: ['.env'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx, notifications } = createContext(cwd)
    const command = fakePi.commands.get('disable-protections')

    expect(command).toBeDefined()
    await command?.handler('', ctx as unknown as ExtensionCommandContext)

    const decision = await fakePi.handler(
      { toolName: 'write', input: { path: '.env' } },
      ctx,
    )

    expect(decision).toBeUndefined()
    expect(notifications).toEqual([
      {
        message: 'Protected file guards disabled for the rest of this session.',
        level: 'warning',
      },
    ])
  })
})

test('treats configured paths as filenames', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ files: ['src/schema.ts'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx } = createContext(cwd)

    const decision = await fakePi.handler(
      { toolName: 'write', input: { path: 'other/schema.ts' } },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason: 'Protected file: other/schema.ts matches src/schema.ts',
    })
  })
})

test('allows confirmed edits in confirm mode', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ mode: 'confirm', files: ['.env'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx, confirmations } = createContext(cwd, true)

    const decision = await fakePi.handler(
      { toolName: 'edit', input: { path: '.env' } },
      ctx,
    )

    expect(decision).toBeUndefined()
    expect(confirmations).toHaveLength(1)
  })
})

test('blocks denied edits in confirm mode', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ mode: 'confirm', files: ['.env'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx } = createContext(cwd, false)

    const decision = await fakePi.handler(
      { toolName: 'edit', input: { path: '.env' } },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason: 'Protected edit denied: .env matches .env',
    })
  })
})

test('blocks nested multi-tool write calls', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ files: ['token.txt'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx } = createContext(cwd)

    const decision = await fakePi.handler(
      {
        toolName: 'multi_tool_use.parallel',
        input: {
          tool_uses: [
            {
              recipient_name: 'functions.write',
              parameters: { path: 'secrets/token.txt' },
            },
          ],
        },
      },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason: 'Protected file: secrets/token.txt matches token.txt',
    })
  })
})

test('blocks glob path entries by parent folder', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ files: ['secrets/**'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx } = createContext(cwd)

    const decision = await fakePi.handler(
      { toolName: 'write', input: { path: 'apps/web/secrets/token.txt' } },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason: 'Protected file: apps/web/secrets/token.txt matches secrets/**',
    })
  })
})

test('blocks mutating bash commands that mention protected files', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ files: ['.env'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx } = createContext(cwd)

    const decision = await fakePi.handler(
      { toolName: 'bash', input: { command: 'echo TOKEN=abc >> .env' } },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason: 'Protected file: .env matches .env',
    })
  })
})

test('blocks mutating bash commands that mention glob path entries', async () => {
  await withTempProject(async (cwd) => {
    await writeFile(
      path.join(cwd, '.pi/protected-files.json'),
      JSON.stringify({ files: ['secrets/**'] }),
    )

    const fakePi = createFakePi()
    createProtectedFilesExtension()(fakePi.api)
    const { ctx } = createContext(cwd)

    const decision = await fakePi.handler(
      {
        toolName: 'bash',
        input: { command: 'touch apps/web/secrets/token.txt' },
      },
      ctx,
    )

    expect(decision).toEqual({
      block: true,
      reason: 'Protected file: secrets/** matches secrets/**',
    })
  })
})
