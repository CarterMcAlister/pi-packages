import { expect, test } from 'bun:test'
import { runRlmWorkflowWithOptions } from '../src/runner'
import type { RlmWorkflowRegistry } from '../src/types'

const registry: RlmWorkflowRegistry = {
  async list() {
    return []
  },
  async get(_cwd, id) {
    if (id !== 'demo') {
      return undefined
    }

    let restoredState: unknown

    return {
      id: 'demo',
      description: 'Demo task',
      source: 'bundled',
      task: {
        id: 'demo',
        description: 'Demo task',
        async prepare() {
          return {
            agent: {
              async forward(_ai, inputs) {
                if (typeof inputs.answer !== 'string') {
                  throw {
                    name: 'AxAgentClarificationError',
                    question: 'Who is this for?',
                    getState() {
                      return { checkpoint: 1 }
                    },
                  }
                }

                return {
                  answer: `Hello ${inputs.answer}`,
                  restoredState,
                }
              },
              setState(state) {
                restoredState = state
              },
            },
            inputs: {},
            clarification: {
              answerField: 'answer',
            },
          }
        },
      },
    }
  },
}

test('runs a task through clarification and resume', async () => {
  const result = await runRlmWorkflowWithOptions(
    {
      task: 'demo',
      debug: true,
    },
    {
      cwd: process.cwd(),
      hasUI: true,
    } as never,
    registry,
    {
      resolveModel: async () => ({
        ai: {},
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        spec: 'anthropic/claude-sonnet-4',
        source: 'active',
      }),
      prompt: async () => 'Ada',
    },
  )

  expect(result.summary).toBe('Hello Ada')
  expect(result.outputText).toContain('# RLM Workflow: demo')
  expect(result.clarifications).toBe(1)
  expect(result.result.restoredState).toEqual({ checkpoint: 1 })
  expect(result.outputText).toContain('Raw Result')
})
