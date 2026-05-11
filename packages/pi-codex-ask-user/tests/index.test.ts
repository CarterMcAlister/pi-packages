import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import registerCodexAskUser from '../src/index'

type ToolResult = {
  content: Array<{ type: string; text: string }>
  isError?: boolean
  details?: unknown
}

type RegisteredTool = {
  execute: (...args: unknown[]) => Promise<ToolResult>
  renderCall?: (...args: unknown[]) => unknown
  renderResult?: (...args: unknown[]) => unknown
}

const renderTheme = {
  fg: (_color: string, value: string) => value,
  bold: (value: string) => value,
}

const baseQuestion = {
  id: 'deploy_target',
  header: 'Deploy',
  question: 'Where should we deploy?',
  options: [
    {
      label: 'Staging (Recommended)',
      description: 'Safe validation before production.',
    },
    {
      label: 'Production',
      description: 'Customer-facing rollout.',
    },
  ],
}

let originalStdoutWrite: typeof process.stdout.write
const envBackup: Record<string, string | undefined> = {}
const tempDirs: string[] = []
const TEST_AGENT_DIR_ENV = 'PI_CODING_AGENT_DIR'

function captureEnv(name: string) {
  if (!(name in envBackup)) envBackup[name] = process.env[name]
}

function restoreEnv() {
  for (const [name, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  for (const name of Object.keys(envBackup)) delete envBackup[name]
}

function setupTool(): {
  tool: RegisteredTool
  events: Array<{ name: string; payload: unknown }>
} {
  let tool: RegisteredTool | undefined
  const events: Array<{ name: string; payload: unknown }> = []
  registerCodexAskUser({
    registerTool(registered: RegisteredTool) {
      tool = registered
    },
    events: {
      emit(name: string, payload: unknown) {
        events.push({ name, payload })
      },
    },
  } as unknown as ExtensionAPI)
  if (!tool) throw new Error('tool was not registered')
  return { tool, events }
}

function createInteractiveContext(
  ui: Record<string, unknown>,
  options: { cwd?: string } = {},
) {
  return {
    cwd: options.cwd ?? process.cwd(),
    hasUI: true,
    ui: {
      notify() {},
      custom: async () => undefined,
      ...ui,
    },
  }
}

function writeSettingsFile(dir: string, settings: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2))
}

function createProjectWithSettings(settings: Record<string, unknown>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'pi-codex-ask-user-'))
  tempDirs.push(cwd)
  writeSettingsFile(join(cwd, '.pi'), settings)
  return cwd
}

beforeEach(() => {
  originalStdoutWrite = process.stdout.write
  process.stdout.write = (() => true) as typeof process.stdout.write
  for (const name of ['WT_SESSION', 'KITTY_WINDOW_ID', TEST_AGENT_DIR_ENV]) {
    captureEnv(name)
    delete process.env[name]
  }
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-codex-ask-user-agent-'))
  tempDirs.push(agentDir)
  process.env[TEST_AGENT_DIR_ENV] = agentDir
})

afterEach(() => {
  process.stdout.write = originalStdoutWrite
  restoreEnv()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('request_user_input', () => {
  test('returns a tool error for malformed params instead of throwing', async () => {
    const { tool } = setupTool()

    const result = await tool.execute(
      'call-1',
      { questions: [{ id: 'missing_fields' }] },
      undefined,
      undefined,
      { hasUI: false },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('request_user_input requires')
    expect(result.details).toEqual({
      questions: [],
      response: null,
      cancelled: true,
      error:
        'request_user_input requires id, header, question, and 2-3 options for every question',
    })
  })

  test('rejects invalid option counts before rendering UI', async () => {
    const { tool } = setupTool()

    const result = await tool.execute(
      'call-1',
      {
        questions: [
          {
            id: 'deploy_target',
            header: 'Deploy',
            question: 'Where should we deploy?',
            options: [
              {
                label: 'Production',
                description: 'Only one structured option.',
              },
            ],
          },
        ],
      },
      undefined,
      undefined,
      { hasUI: false },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'request_user_input requires id, header, question, and 2-3 options for every question',
    )
  })

  test('rejects duplicate question ids before rendering UI', async () => {
    const { tool } = setupTool()

    const result = await tool.execute(
      'call-1',
      {
        questions: [
          baseQuestion,
          { ...baseQuestion, question: 'Deploy again?' },
        ],
      },
      undefined,
      undefined,
      { hasUI: false },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'request_user_input requires unique question ids',
    )
  })

  test('rejects duplicate option labels before rendering UI', async () => {
    const { tool } = setupTool()

    const result = await tool.execute(
      'call-1',
      {
        questions: [
          {
            id: 'deploy_target',
            header: 'Deploy',
            question: 'Where should we deploy?',
            options: [
              {
                label: 'Production',
                description: 'First production path.',
              },
              {
                label: 'Production',
                description: 'Second production path.',
              },
            ],
          },
        ],
      },
      undefined,
      undefined,
      { hasUI: false },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'request_user_input requires unique option labels for every question',
    )
  })

  test('rejects ambiguous option labels before rendering UI', async () => {
    const { tool } = setupTool()

    const result = await tool.execute(
      'call-1',
      {
        questions: [
          {
            id: 'deploy_target',
            header: 'Deploy',
            question: 'Where should we deploy?',
            options: [
              {
                label: 'None of the above',
                description: 'Conflicts with the built-in freeform action.',
              },
              {
                label: 'Production',
                description: 'Customer-facing rollout.',
              },
            ],
          },
        ],
      },
      undefined,
      undefined,
      createInteractiveContext({
        select: async () => 'should not be called',
        input: async () => '',
      }),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'request_user_input option labels must not use reserved labels',
    )
  })

  test('rejects blank required strings before rendering UI', async () => {
    const { tool } = setupTool()

    const result = await tool.execute(
      'call-1',
      {
        questions: [
          {
            id: 'deploy_target',
            header: 'Deploy',
            question: 'Where should we deploy?',
            options: [
              { label: ' ', description: 'Safe validation.' },
              {
                label: 'Production',
                description: 'Customer-facing rollout.',
              },
            ],
          },
        ],
      },
      undefined,
      undefined,
      createInteractiveContext({
        select: async () => 'should not be called',
        input: async () => '',
      }),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'request_user_input requires label and description for every option',
    )
  })

  test('keeps Codex response shape while treating None of the above as freeform', async () => {
    const { tool } = setupTool()
    let selectOptions: string[] = []
    const ctx = createInteractiveContext({
      select: async (_prompt: string, options: string[]) => {
        selectOptions = options
        return 'None of the above'
      },
      input: async () => 'Use preview instead',
    })

    const result = await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(result.isError).toBeUndefined()
    expect(selectOptions).toEqual([
      'Staging (Recommended)',
      'Production',
      'None of the above',
    ])
    expect(JSON.parse(result.content[0].text)).toEqual({
      answers: {
        deploy_target: { answers: ['Use preview instead'] },
      },
    })
  })

  test('preserves optional user notes after structured selections', async () => {
    const { tool } = setupTool()
    const ctx = createInteractiveContext({
      select: async () => 'Production',
      input: async () => 'Need a fast rollback window.',
    })

    const result = await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(JSON.parse(result.content[0].text)).toEqual({
      answers: {
        deploy_target: {
          answers: ['Production', 'user_note: Need a fast rollback window.'],
        },
      },
    })
  })

  test('uses settings-configured inline display mode', async () => {
    const cwd = createProjectWithSettings({
      piCodexAskUser: { displayMode: 'inline' },
    })
    const { tool } = setupTool()
    let customOptions: unknown = 'not-called'
    const ctx = createInteractiveContext(
      {
        custom: async (_factory: unknown, options: unknown) => {
          customOptions = options
          return { kind: 'selection', selections: ['Production'] }
        },
        select: async () => {
          throw new Error('select should not be used when custom UI resolves')
        },
        input: async () => '',
      },
      { cwd },
    )

    const result = await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(customOptions).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({
      answers: {
        deploy_target: { answers: ['Production'] },
      },
    })
  })

  test('supports settings-enabled multi-select without changing the Codex tool shape', async () => {
    const cwd = createProjectWithSettings({
      piCodexAskUser: { allowMultiple: true },
    })
    const { tool } = setupTool()
    const inputPrompts: string[] = []
    const ctx = createInteractiveContext(
      {
        input: async (prompt: string) => {
          inputPrompts.push(prompt)
          return inputPrompts.length === 1 ? '1, 2' : ''
        },
        select: async () => {
          throw new Error('select should not be used in multi-select mode')
        },
      },
      { cwd },
    )

    const result = await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(inputPrompts[0]).toContain('select one or more')
    expect(JSON.parse(result.content[0].text)).toEqual({
      answers: {
        deploy_target: {
          answers: ['Staging (Recommended)', 'Production'],
        },
      },
    })
  })

  test('supports freeform response in settings-enabled multi-select fallback', async () => {
    const cwd = createProjectWithSettings({
      piCodexAskUser: { allowMultiple: true },
    })
    const { tool } = setupTool()
    const inputPrompts: string[] = []
    const ctx = createInteractiveContext(
      {
        input: async (prompt: string) => {
          inputPrompts.push(prompt)
          return inputPrompts.length === 1 ? '3' : 'Use canary first'
        },
        select: async () => {
          throw new Error('select should not be used in multi-select mode')
        },
      },
      { cwd },
    )

    const result = await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(inputPrompts[0]).toContain('None of the above')
    expect(inputPrompts[1]).toContain('Where should we deploy?')
    expect(JSON.parse(result.content[0].text)).toEqual({
      answers: {
        deploy_target: { answers: ['Use canary first'] },
      },
    })
  })

  test('allows project settings to clear a global timeout', async () => {
    const cwd = createProjectWithSettings({
      piCodexAskUser: { timeoutMs: null },
    })
    const agentDir = process.env[TEST_AGENT_DIR_ENV]
    if (!agentDir) throw new Error(`${TEST_AGENT_DIR_ENV} was not set`)
    writeSettingsFile(agentDir, {
      piCodexAskUser: { timeoutMs: 1234 },
    })
    const { tool } = setupTool()
    let selectOptionsArg: unknown = 'not-called'
    const ctx = createInteractiveContext(
      {
        select: async (
          _prompt: string,
          _options: string[],
          dialogOptions: unknown,
        ) => {
          selectOptionsArg = dialogOptions
          return 'Staging (Recommended)'
        },
        input: async () => '',
      },
      { cwd },
    )

    await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(selectOptionsArg).toBeUndefined()
  })

  test('returns promptly when fallback dialogs are aborted', async () => {
    const controller = new AbortController()
    const { tool } = setupTool()
    const ctx = createInteractiveContext({
      custom: async () => undefined,
      select: async () => {
        controller.abort()
        return new Promise(() => {})
      },
      input: async () => '',
    })

    const result = await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      controller.signal,
      undefined,
      ctx,
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      'request_user_input was cancelled before receiving a response',
    )
  })

  test('applies settings-configured timeout to fallback dialogs', async () => {
    const cwd = createProjectWithSettings({
      piCodexAskUser: { timeoutMs: 1234 },
    })
    const { tool } = setupTool()
    let selectOptionsArg: unknown
    const ctx = createInteractiveContext(
      {
        select: async (
          _prompt: string,
          _options: string[],
          dialogOptions: unknown,
        ) => {
          selectOptionsArg = dialogOptions
          return 'Staging (Recommended)'
        },
        input: async () => '',
      },
      { cwd },
    )

    await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(selectOptionsArg).toEqual({ timeout: 1234 })
  })

  test('gracefully returns an answerable prompt when interactive UI is unavailable', async () => {
    const { tool } = setupTool()

    const result = await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      { hasUI: false },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Where should we deploy?')
    expect(result.content[0].text).toContain('Staging (Recommended)')
    expect(result.content[0].text).toContain('None of the above')
  })

  test('call rendering ignores malformed partial questions', async () => {
    const { tool } = setupTool()
    if (!tool.renderCall) throw new Error('renderCall was not registered')

    const rendered = tool.renderCall(
      { questions: [{ id: 'partial' }] },
      renderTheme,
    ) as { render(width: number): string[] }

    const text = rendered.render(200).join('\n')
    expect(text).toContain('request_user_input')
    expect(text).toContain('1 question')
    expect(text).not.toContain('undefined')
  })

  test('expanded rendering does not confuse option labels with user notes', async () => {
    const { tool } = setupTool()
    if (!tool.renderResult) throw new Error('renderResult was not registered')
    const question = {
      id: 'risk',
      header: 'Risk',
      question: 'Which risk posture?',
      options: [
        {
          label: 'user_note: explicit risk acceptance',
          description: 'Select this as a real option.',
        },
      ],
    }

    const rendered = tool.renderResult(
      {
        content: [{ type: 'text', text: '{}' }],
        details: {
          questions: [question],
          response: {
            answers: {
              risk: { answers: ['user_note: explicit risk acceptance'] },
            },
          },
          cancelled: false,
        },
      },
      { expanded: true, isPartial: false },
      renderTheme,
    ) as { render(width: number): string[] }

    const text = rendered.render(200).join('\n')
    expect(text).toContain('● user_note: explicit risk acceptance')
    expect(text).not.toContain('Comment: explicit risk acceptance')
  })

  test('emits waiting and answered events for successful responses', async () => {
    const { tool, events } = setupTool()
    const ctx = createInteractiveContext({
      select: async () => 'Staging (Recommended)',
      input: async () => '',
    })

    await tool.execute(
      'call-1',
      { questions: [baseQuestion] },
      undefined,
      undefined,
      ctx,
    )

    expect(events.map((event) => event.name)).toEqual([
      'request_user_input:waiting',
      'request_user_input:answered',
    ])
  })
})
