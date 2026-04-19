import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'
import { runAxTask, runAxTaskWithOptions } from './runner'
import type { AxTaskRegistry, AxTaskRunner, AxTaskRunResult } from './types'

const RlmWorkflowParams = Type.Object({
  task: Type.String({ description: 'The RLM workflow id to run' }),
  query: Type.Optional(
    Type.String({
      description:
        'Optional focus instruction or audience guidance for the workflow',
    }),
  ),
  inputs: Type.Optional(
    Type.Record(
      Type.String(),
      Type.String({ description: 'Workflow input value' }),
      { description: 'String inputs passed to the workflow' },
    ),
  ),
  model: Type.Optional(
    Type.String({
      description:
        'Optional model override as provider/model, e.g. anthropic/claude-sonnet-4',
    }),
  ),
  debug: Type.Optional(
    Type.Boolean({
      description: 'Include status updates and raw result in the output',
    }),
  ),
})

const PRIMARY_TOOL_NAME = 'rlm_task'

function getResultLines(result: AxTaskRunResult): string[] {
  return result.outputText.split('\n')
}

export function registerRlmWorkflowTool(
  pi: ExtensionAPI,
  registry: AxTaskRegistry,
  runTask: AxTaskRunner,
) {
  pi.registerTool({
    name: PRIMARY_TOOL_NAME,
    label: 'RLM workflow',
    description:
      'Run a named RLM workflow for repeatable long-context analysis tasks such as incident reviews and RFC checks.',
    promptSnippet:
      'Run named RLM workflows for rubric-driven long-context analysis tasks.',
    promptGuidelines: [
      'Use rlm_task for named, reusable RLM workflows such as incident-review or rfc-quality-check.',
      'Prefer ordinary Pi tools for simple edits, quick shell commands, and one-off questions.',
      'Pass compact string inputs and reuse the active model unless the user explicitly asks for another model.',
    ],
    parameters: RlmWorkflowParams,

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const request = {
        task: params.task,
        query: params.query,
        inputs: params.inputs,
        model: params.model,
        debug: params.debug,
      }

      const result =
        runTask === runAxTask
          ? await runAxTaskWithOptions(request, ctx, registry, {
              emitProgress(message) {
                onUpdate?.({
                  content: [{ type: 'text', text: message }],
                  details: {},
                })
              },
            })
          : await runTask(request, ctx, registry)

      onUpdate?.({
        content: [{ type: 'text', text: `Completed ${result.taskId}` }],
        details: result,
      })

      return {
        content: [{ type: 'text', text: result.outputText }],
        details: result,
      }
    },

    renderCall(callArgs, theme) {
      let text = theme.fg('toolTitle', theme.bold(`${PRIMARY_TOOL_NAME} `))
      text += theme.fg('accent', callArgs.task)
      if (callArgs.model) {
        text += theme.fg('dim', ` @ ${callArgs.model}`)
      }
      if (callArgs.query) {
        text += theme.fg('muted', ` — ${callArgs.query}`)
      }
      return new Text(text, 0, 0)
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg('warning', 'Running RLM workflow...'), 0, 0)
      }

      const details = result.details as AxTaskRunResult | undefined
      if (!details) {
        return new Text(theme.fg('error', 'No workflow result'), 0, 0)
      }

      let text = theme.fg('success', `${details.taskId} completed`)
      text += theme.fg('dim', ` via ${details.model.spec}`)

      if (details.clarifications > 0) {
        text += theme.fg(
          'warning',
          ` (${details.clarifications} clarification${details.clarifications === 1 ? '' : 's'})`,
        )
      }

      if (expanded) {
        const lines = getResultLines(details).slice(0, 16)
        for (const line of lines) {
          text += `\n${theme.fg('dim', line)}`
        }
        if (getResultLines(details).length > lines.length) {
          text += `\n${theme.fg('muted', '...')}`
        }
      } else {
        text += `\n${theme.fg('muted', details.summary)}`
      }

      return new Text(text, 0, 0)
    },
  })
}
