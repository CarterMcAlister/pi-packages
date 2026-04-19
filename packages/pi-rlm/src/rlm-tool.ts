import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'
import { Type } from '@sinclair/typebox'
import { runRlmEngine } from './rlm-engine'
import { rlmRunStore } from './rlm-runs'
import type {
  RlmRunRecord,
  RlmRunResult,
  RlmStartRequest,
  RlmToolOp,
} from './types'

export const DEFAULT_WAIT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_DEPTH = 2
export const DEFAULT_MAX_NODES = 12
export const DEFAULT_MAX_BRANCHING = 3
export const DEFAULT_CONCURRENCY = 1

export const RlmToolParams = Type.Object({
  op: Type.Optional(
    Type.Union([
      Type.Literal('start'),
      Type.Literal('status'),
      Type.Literal('wait'),
      Type.Literal('cancel'),
    ]),
  ),
  id: Type.Optional(
    Type.String({ description: 'Run ID for status/wait/cancel' }),
  ),
  task: Type.Optional(
    Type.String({ description: 'Task to solve recursively' }),
  ),
  mode: Type.Optional(
    Type.Union([
      Type.Literal('auto'),
      Type.Literal('solve'),
      Type.Literal('decompose'),
    ]),
  ),
  async: Type.Optional(
    Type.Boolean({ description: 'Return immediately and run in background' }),
  ),
  model: Type.Optional(
    Type.String({ description: 'Optional provider/model override' }),
  ),
  cwd: Type.Optional(
    Type.String({ description: 'Working directory for the run' }),
  ),
  maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
  maxNodes: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
  maxBranching: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
  waitTimeoutMs: Type.Optional(
    Type.Integer({ minimum: 100, maximum: 3_600_000 }),
  ),
})

function shortText(value: string | undefined, maxLength = 88): string {
  if (!value) {
    return ''
  }

  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trimEnd()}…`
}

function statusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✓'
    case 'running':
      return '…'
    case 'failed':
      return '✗'
    case 'cancelled':
      return '○'
    default:
      return '-'
  }
}

function formatNodeTreeLines(
  node: RlmRunResult['root'],
  prefix = '',
  isLast = true,
): string[] {
  const connector = prefix ? (isLast ? '└─ ' : '├─ ') : ''
  const detailPrefix = `${prefix}${prefix ? (isLast ? '   ' : '│  ') : ''}`
  const summary = node.result ?? node.error ?? node.decision?.reason ?? ''
  const lines = [
    `${prefix}${connector}${statusIcon(node.status)} [${node.id}] d${node.depth} ${node.task}`,
  ]

  if (summary) {
    lines.push(`${detailPrefix}${shortText(summary)}`)
  }

  node.children.forEach((child, index) => {
    lines.push(
      ...formatNodeTreeLines(
        child,
        detailPrefix,
        index === node.children.length - 1,
      ),
    )
  })

  return lines
}

export function summarizeRun(result: RlmRunResult): string {
  return [
    `# RLM Run: ${result.runId}`,
    '',
    `Model: ${result.model}`,
    `Nodes visited: ${result.stats.nodesVisited}`,
    `Max depth seen: ${result.stats.maxDepthSeen}`,
    `Duration: ${result.stats.durationMs}ms`,
    '',
    '## Tree',
    ...formatNodeTreeLines(result.root),
    '',
    '## Recent Activity',
    ...(result.events.length > 0
      ? result.events.slice(-12).map((event) => `- ${event}`)
      : ['- No recorded events']),
    '',
    '## Final Output',
    result.final,
    '',
    '## Artifacts',
    `- ${result.artifacts.dir}`,
    `- ${result.artifacts.treePath}`,
    `- ${result.artifacts.outputPath}`,
    `- ${result.artifacts.eventsPath}`,
  ].join('\n')
}

export function summarizeRecord(id: string) {
  const record = rlmRunStore.get(id)
  if (!record) {
    throw new Error(`Unknown run id: ${id}`)
  }

  return toRecordSummary(record)
}

export function summarizeRecentRuns() {
  return rlmRunStore.list().slice(0, 10).map(toRecordSummary)
}

export function summarizeRunningRuns() {
  return rlmRunStore
    .list()
    .filter((record) => record.status === 'running')
    .slice(0, 10)
    .map(toRecordSummary)
}

export function formatRecentRunsText(
  records: ReturnType<typeof summarizeRecentRuns>,
): string {
  return [
    '# RLM Runs',
    '',
    ...(records.length > 0
      ? records.flatMap((record) => [
          `- ${statusIcon(record.status)} ${record.id} [${record.status}] ${record.task}`,
          `  mode: ${record.mode}`,
          ...(record.currentActivity
            ? [`  current: ${record.currentActivity}`]
            : []),
        ])
      : ['No RLM runs found.']),
  ].join('\n')
}

export function formatRecordText(
  record: ReturnType<typeof summarizeRecord>,
): string {
  return [
    `# RLM Run: ${record.id}`,
    '',
    `Status: ${record.status}`,
    `Mode: ${record.mode}`,
    `Task: ${record.task}`,
    ...(record.currentActivity
      ? [`Current Activity: ${record.currentActivity}`]
      : []),
    ...(record.error ? [`Error: ${record.error}`] : []),
    '',
    '## Recent Activity',
    ...(record.recentEvents.length > 0
      ? record.recentEvents.slice(-12).map((event) => `- ${event}`)
      : ['- No recorded events']),
    ...(record.result
      ? [
          '',
          '## Tree',
          ...formatNodeTreeLines(record.result.root),
          '',
          '## Final Output',
          record.result.final,
          '',
          '## Artifacts',
          `- ${record.result.artifacts.dir}`,
          `- ${record.result.artifacts.treePath}`,
          `- ${record.result.artifacts.outputPath}`,
          `- ${record.result.artifacts.eventsPath}`,
        ]
      : []),
  ].join('\n')
}

function toRecordSummary(record: RlmRunRecord) {
  return {
    id: record.id,
    status: record.status,
    task: record.input.task,
    mode: record.input.mode,
    currentActivity: record.currentActivity,
    recentEvents: record.recentEvents,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    error: record.error,
    result: record.result
      ? {
          runId: record.result.runId,
          root: record.result.root,
          model: record.result.model,
          final: record.result.final,
          events: record.result.events,
          stats: record.result.stats,
          artifacts: record.result.artifacts,
        }
      : undefined,
  }
}

export function createStartRequest(params: {
  task?: string
  mode?: 'auto' | 'solve' | 'decompose'
  maxDepth?: number
  maxNodes?: number
  maxBranching?: number
  concurrency?: number
  model?: string
  cwd?: string
  defaultCwd: string
}): RlmStartRequest {
  if (!params.task?.trim()) {
    throw new Error('rlm start requires a task')
  }

  return {
    task: params.task,
    mode: params.mode ?? 'auto',
    maxDepth: params.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxNodes: params.maxNodes ?? DEFAULT_MAX_NODES,
    maxBranching: params.maxBranching ?? DEFAULT_MAX_BRANCHING,
    concurrency: params.concurrency ?? DEFAULT_CONCURRENCY,
    model: params.model,
    cwd: params.cwd ?? params.defaultCwd,
  }
}

export function registerRlmTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'rlm',
    label: 'Recursive RLM',
    description:
      'Run a true recursive language model decomposition with planner, worker, and synthesizer nodes.',
    promptSnippet:
      'Use rlm for recursive decomposition when a task benefits from planner/worker/synthesizer orchestration.',
    promptGuidelines: [
      'Use rlm for open-ended tasks that may benefit from recursive decomposition.',
      'Use rlm_task for fixed named workflows such as incident-review or rfc-quality-check.',
      'Prefer mode=auto unless you explicitly want solve-only or forced decomposition behavior.',
      'Use status or wait when the user wants to inspect what the recursive run is doing.',
    ],
    parameters: RlmToolParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const op = (params.op ?? 'start') as RlmToolOp

      if (op === 'status') {
        if (params.id) {
          const payload = summarizeRecord(params.id)
          return {
            content: [{ type: 'text', text: formatRecordText(payload) }],
            details: payload,
          }
        }

        const payload = summarizeRecentRuns()
        return {
          content: [{ type: 'text', text: formatRecentRunsText(payload) }],
          details: payload,
        }
      }

      if (op === 'wait') {
        if (!params.id) {
          throw new Error('rlm wait requires an id')
        }
        const waited = await rlmRunStore.wait(
          params.id,
          params.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
        )
        const payload = summarizeRecord(params.id)
        return {
          content: [{ type: 'text', text: formatRecordText(payload) }],
          details: { ...payload, done: waited.done },
        }
      }

      if (op === 'cancel') {
        if (!params.id) {
          throw new Error('rlm cancel requires an id')
        }
        const record = rlmRunStore.cancel(params.id)
        const payload = summarizeRecord(record.id)
        return {
          content: [{ type: 'text', text: formatRecordText(payload) }],
          details: payload,
        }
      }

      const request = createStartRequest({
        task: params.task,
        mode: params.mode,
        maxDepth: params.maxDepth,
        maxNodes: params.maxNodes,
        maxBranching: params.maxBranching,
        concurrency: params.concurrency,
        model: params.model,
        cwd: params.cwd,
        defaultCwd: ctx.cwd,
      })

      const record = rlmRunStore.start(
        request,
        async (runId, runSignal) =>
          runRlmEngine(
            {
              ...request,
              runId,
            },
            { ...ctx, cwd: request.cwd },
            {
              signal: runSignal,
              onProgress(message) {
                rlmRunStore.appendEvent(runId, message)
                onUpdate?.({
                  content: [{ type: 'text', text: message }],
                  details: {},
                })
              },
            },
          ),
        signal,
      )

      rlmRunStore.appendEvent(record.id, `Run queued for ${request.task}`)

      if (params.async) {
        const payload = summarizeRecord(record.id)
        return {
          content: [{ type: 'text', text: formatRecordText(payload) }],
          details: payload,
        }
      }

      const result = await record.promise
      const output = summarizeRun(result)
      return {
        content: [{ type: 'text', text: output }],
        details: result,
      }
    },

    renderCall(args, theme) {
      const op = (args.op ?? 'start') as string
      let text = theme.fg('toolTitle', theme.bold('rlm '))
      text += theme.fg('accent', op)
      if (args.task) {
        text += theme.fg('muted', ` — ${args.task}`)
      } else if (args.id) {
        text += theme.fg('muted', ` — ${args.id}`)
      }
      return new Text(text, 0, 0)
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg('warning', 'Running recursive RLM...'), 0, 0)
      }

      const details = result.details as Partial<RlmRunResult> | undefined
      if (!details) {
        return new Text(theme.fg('error', 'No RLM result'), 0, 0)
      }

      let text = theme.fg('success', 'RLM run complete')
      if (typeof details.runId === 'string') {
        text += theme.fg('dim', ` ${details.runId}`)
      }
      if (details.model) {
        text += theme.fg('dim', ` via ${details.model}`)
      }
      if (expanded && details.final) {
        text += `\n${theme.fg('muted', details.final)}`
      }
      return new Text(text, 0, 0)
    },
  })
}
