import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  isAxClarificationError,
  normalizeClarification,
  promptForClarification,
} from './clarification'
import { resolveAxModel } from './model'
import type {
  AxFormattedTaskResult,
  AxTaskHelpers,
  AxTaskRegistry,
  AxTaskRunner,
  AxTaskRunRequest,
  AxTaskRunResult,
  AxTaskStatusKind,
  AxTaskStatusUpdate,
  ResolvedAxModel,
} from './types'

interface RunAxTaskOptions {
  emitProgress?: (message: string, kind?: AxTaskStatusKind) => void
  resolveModel?: typeof resolveAxModel
  prompt?: typeof promptForClarification
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return {
    value,
  }
}

function createHelpers(cwd: string): AxTaskHelpers {
  return {
    async readTextFile(path: string) {
      const absolutePath = resolve(cwd, path)
      if (!existsSync(absolutePath)) {
        throw new Error(`Task input file not found: ${path}`)
      }

      return Bun.file(absolutePath).text()
    },
    resolvePath(path: string) {
      return resolve(cwd, path)
    },
  }
}

function defaultFormatTaskResult(
  result: Record<string, unknown>,
): AxFormattedTaskResult {
  const summary =
    typeof result.answer === 'string'
      ? result.answer
      : 'Task completed successfully.'

  return {
    summary,
    result,
  }
}

function buildOutputText(args: {
  taskId: string
  description: string
  source: AxTaskRunResult['source']
  model: Omit<ResolvedAxModel, 'ai'>
  summary: string
  markdown?: string
  result: Record<string, unknown>
  clarifications: number
  debug: boolean
  statusUpdates: AxTaskStatusUpdate[]
}): string {
  const lines: string[] = [
    `# RLM Workflow: ${args.taskId}`,
    '',
    `Description: ${args.description}`,
    `Source: ${args.source}`,
    `Model: ${args.model.spec}`,
    `Clarifications: ${args.clarifications}`,
  ]

  if (args.markdown?.trim()) {
    lines.push('', args.markdown.trim())
  } else {
    lines.push('', '## Summary', args.summary)
  }

  if (args.debug) {
    lines.push(
      '',
      '## Status Updates',
      ...(args.statusUpdates.length > 0
        ? args.statusUpdates.map(
            (update) => `- [${update.kind}] ${update.message}`,
          )
        : ['- No status updates recorded']),
      '',
      '## Raw Result',
      '```json',
      stringifyJson(args.result),
      '```',
    )
  }

  return lines.join('\n')
}

export async function runAxTask(
  request: AxTaskRunRequest,
  ctx: ExtensionContext,
  registry: AxTaskRegistry,
): Promise<AxTaskRunResult> {
  return runAxTaskWithOptions(request, ctx, registry)
}

export const runRlmWorkflow = runAxTask

export async function runAxTaskWithOptions(
  request: AxTaskRunRequest,
  ctx: ExtensionContext,
  registry: AxTaskRegistry,
  options: RunAxTaskOptions = {},
): Promise<AxTaskRunResult> {
  const emitProgress = options.emitProgress
  const resolveModel = options.resolveModel ?? resolveAxModel
  const prompt = options.prompt ?? promptForClarification
  const statusUpdates: AxTaskStatusUpdate[] = []

  const onStatus = (message: string, kind: AxTaskStatusKind = 'info') => {
    statusUpdates.push({ message, kind })
    emitProgress?.(message, kind)
  }

  const loadedTask = await registry.get(ctx.cwd, request.task)
  if (!loadedTask) {
    throw new Error(`Unknown RLM workflow: ${request.task}`)
  }

  onStatus(`Preparing ${loadedTask.id}`)

  const prepareContext = {
    cwd: ctx.cwd,
    query: request.query,
    inputs: request.inputs ?? {},
    helpers: createHelpers(ctx.cwd),
    model: request.model ?? loadedTask.task.defaultModel,
    onStatus,
  }

  const prepared = await loadedTask.task.prepare(prepareContext)
  onStatus(`Prepared ${loadedTask.id}`, 'success')

  const resolvedModel = await resolveModel(
    ctx,
    request.model,
    loadedTask.task.defaultModel,
  )
  onStatus(`Using ${resolvedModel.spec}`, 'success')

  let currentInputs = { ...prepared.inputs }
  let clarifications = 0

  for (;;) {
    try {
      const rawResult = await prepared.agent.forward(
        resolvedModel.ai,
        currentInputs,
      )
      const resultRecord = toRecord(rawResult)
      const formatted =
        loadedTask.task.formatResult?.({
          result: rawResult,
          prepared,
          context: prepareContext,
        }) ?? defaultFormatTaskResult(resultRecord)

      const finalResult = formatted.result ?? resultRecord
      const outputText = buildOutputText({
        taskId: loadedTask.id,
        description: loadedTask.description,
        source: loadedTask.source,
        model: {
          provider: resolvedModel.provider,
          modelId: resolvedModel.modelId,
          spec: resolvedModel.spec,
          source: resolvedModel.source,
        },
        summary: formatted.summary,
        markdown: formatted.markdown,
        result: finalResult,
        clarifications,
        debug: request.debug ?? false,
        statusUpdates,
      })

      return {
        taskId: loadedTask.id,
        description: loadedTask.description,
        source: loadedTask.source,
        sourcePath: loadedTask.path,
        model: {
          provider: resolvedModel.provider,
          modelId: resolvedModel.modelId,
          spec: resolvedModel.spec,
          source: resolvedModel.source,
        },
        summary: formatted.summary,
        outputText,
        markdown: formatted.markdown,
        result: finalResult,
        statusUpdates,
        clarifications,
        debug: request.debug ?? false,
      }
    } catch (error) {
      if (!isAxClarificationError(error)) {
        throw error
      }

      const clarification = normalizeClarification(
        error.clarification ?? error.question,
      )
      clarifications += 1
      onStatus(`Clarification needed: ${clarification.question}`)

      const answer = await prompt(ctx, clarification)
      if (answer == null) {
        throw new Error(
          `Cancelled while answering a clarification for workflow "${loadedTask.id}".`,
        )
      }

      prepared.agent.setState?.(error.getState?.())

      currentInputs = prepared.clarification?.applyAnswer
        ? await prepared.clarification.applyAnswer({
            currentInputs,
            answer,
            clarification,
          })
        : {
            ...currentInputs,
            [prepared.clarification?.answerField ?? 'answer']: answer,
          }

      onStatus('Clarification answered', 'success')
    }
  }
}

export const runRlmWorkflowWithOptions = runAxTaskWithOptions

export const axTaskRunner: AxTaskRunner = runAxTask
export const rlmWorkflowRunner: AxTaskRunner = runAxTask
