import { expect, test } from 'bun:test'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { createPiRlm } from '../src/index'
import { rlmRunStore } from '../src/rlm-runs'
import type { RlmWorkflowRegistry, RlmWorkflowRunner } from '../src/types'

test('registers recursive RLM tool, /rlm, and workflow surfaces', async () => {
  const tools: string[] = []
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >()

  const registry: RlmWorkflowRegistry = {
    async list() {
      return [
        {
          id: 'incident-review',
          description: 'Incident review',
          source: 'bundled',
          task: {
            id: 'incident-review',
            description: 'Incident review',
            async prepare() {
              return {
                agent: {
                  async forward() {
                    return { answer: 'ok' }
                  },
                },
                inputs: {},
              }
            },
          },
        },
      ]
    },
    async get(cwd, id) {
      return (await this.list(cwd)).find((task) => task.id === id)
    },
  }

  const runTask: RlmWorkflowRunner = async (request) => ({
    taskId: request.task,
    description: 'Incident review',
    source: 'bundled',
    model: {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4',
      spec: 'anthropic/claude-sonnet-4',
      source: 'active',
    },
    summary: 'done',
    outputText: '# RLM Workflow',
    result: { answer: 'done' },
    statusUpdates: [],
    clarifications: 0,
    debug: false,
  })

  const extension = createPiRlm({ registry, runTask })
  const pi = {
    on() {},
    registerTool(tool: { name: string }) {
      tools.push(tool.name)
    },
    registerCommand(
      name: string,
      command: { handler: (args: string, ctx: unknown) => Promise<void> },
    ) {
      commands.set(name, command)
    },
    registerMessageRenderer() {},
  } as unknown as ExtensionAPI

  await extension(pi)

  expect(tools).toContain('rlm')
  expect(tools).toContain('rlm_task')
  expect(commands.has('rlm')).toBe(true)
  expect(commands.has('rlm-list')).toBe(true)
  expect(commands.has('rlm-task')).toBe(true)

  const workflowOutput: { customCalls: number; notifications: string[] } = {
    customCalls: 0,
    notifications: [],
  }
  await commands.get('rlm-task')?.handler('list', {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      async custom(
        _factory: () => { render: (width: number) => string[] | string },
      ) {
        workflowOutput.customCalls += 1
      },
      notify(message: string) {
        workflowOutput.notifications.push(message)
      },
    },
  })

  expect(workflowOutput.customCalls).toBe(1)

  const seeded = rlmRunStore.start(
    {
      task: 'Seeded repo summary',
      mode: 'auto',
      maxDepth: 1,
      maxNodes: 3,
      maxBranching: 2,
      concurrency: 1,
      cwd: process.cwd(),
    },
    async (runId) => ({
      runId,
      root: {
        id: 'n1',
        task: 'Seeded repo summary',
        depth: 0,
        status: 'completed',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        result: 'Seeded result',
        children: [],
      },
      final: 'Seeded result',
      model: 'anthropic/claude-sonnet-4',
      artifacts: {
        dir: '/tmp/pi-rlm-test',
        eventsPath: '/tmp/pi-rlm-test/events.log',
        treePath: '/tmp/pi-rlm-test/tree.json',
        outputPath: '/tmp/pi-rlm-test/output.md',
      },
      events: ['seeded'],
      stats: {
        nodesVisited: 1,
        maxDepthSeen: 0,
        durationMs: 1,
      },
    }),
  )
  await seeded.promise

  const rlmListOutput: {
    customCalls: number
    notifications: string[]
    selections: string[][]
  } = {
    customCalls: 0,
    notifications: [],
    selections: [],
  }
  await commands.get('rlm-list')?.handler('', {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      async custom(
        _factory: () => { render: (width: number) => string[] | string },
      ) {
        rlmListOutput.customCalls += 1
      },
      async select(_title: string, options: string[]) {
        rlmListOutput.selections.push(options)
        return options[0]
      },
      notify(message: string) {
        rlmListOutput.notifications.push(message)
      },
    },
  })

  expect(rlmListOutput.selections[0]?.length).toBeGreaterThan(0)
  expect(rlmListOutput.customCalls).toBe(1)
})
