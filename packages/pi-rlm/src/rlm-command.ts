import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { refreshRlmRunsWidget, showCommandOutput } from './command-ui'
import { runRlmEngine } from './rlm-engine'
import { rlmRunStore } from './rlm-runs'
import {
  createStartRequest,
  formatRecordText,
  summarizeRecentRuns,
  summarizeRecord,
} from './rlm-tool'

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let escaped = false

  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseStartParams(
  tokens: string[],
): Record<string, string | boolean | number | undefined> {
  const params: Record<string, string | boolean | number | undefined> = {}
  const taskParts: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) {
      continue
    }

    if (!token.startsWith('--')) {
      taskParts.push(token)
      continue
    }

    const trimmed = token.slice(2)
    const equalsIndex = trimmed.indexOf('=')
    const key = equalsIndex === -1 ? trimmed : trimmed.slice(0, equalsIndex)
    const inlineValue =
      equalsIndex === -1 ? undefined : trimmed.slice(equalsIndex + 1)

    if (key === 'async') {
      params.async = inlineValue ? inlineValue !== 'false' : true
      continue
    }

    const nextToken = inlineValue ?? tokens[index + 1]
    if (!inlineValue) {
      if (!nextToken || nextToken.startsWith('--')) {
        throw new Error(`Missing value for --${key}`)
      }
      index += 1
    }

    const value = nextToken

    switch (key) {
      case 'mode':
      case 'model':
      case 'cwd':
        params[key] = value
        break
      case 'maxDepth':
      case 'maxNodes':
      case 'maxBranching':
      case 'concurrency':
        params[key] = toNumber(value)
        break
      default:
        throw new Error(`Unknown flag: --${key}`)
    }
  }

  params.task = taskParts.join(' ').trim() || undefined
  return params
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

function shortText(value: string, maxLength = 64): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trimEnd()}…`
}

export function registerRlmCommand(pi: ExtensionAPI) {
  pi.registerCommand('rlm', {
    description:
      'Start a recursive RLM run: /rlm <task> [--async] [--model provider/model] [--maxDepth N] [--maxNodes N]',
    handler: async (args, ctx) => {
      try {
        const params = parseStartParams(tokenizeCommand(args))
        const request = createStartRequest({
          task: params.task as string | undefined,
          mode: params.mode as 'auto' | 'solve' | 'decompose' | undefined,
          maxDepth: params.maxDepth as number | undefined,
          maxNodes: params.maxNodes as number | undefined,
          maxBranching: params.maxBranching as number | undefined,
          concurrency: params.concurrency as number | undefined,
          model: params.model as string | undefined,
          cwd: params.cwd as string | undefined,
          defaultCwd: ctx.cwd,
        })

        const record = rlmRunStore.start(request, async (runId, signal) =>
          runRlmEngine(
            {
              ...request,
              runId,
            },
            { ...ctx, cwd: request.cwd },
            {
              signal,
              onProgress(message) {
                rlmRunStore.appendEvent(runId, message)
              },
            },
          ),
        )

        rlmRunStore.appendEvent(record.id, `Run queued for ${request.task}`)
        refreshRlmRunsWidget(ctx)
        ctx.ui.notify(`RLM run started: ${record.id}`, 'info')

        if (params.async === true) {
          await showCommandOutput(
            ctx,
            `RLM Run ${record.id}`,
            formatRecordText(summarizeRecord(record.id)),
          )
          return
        }

        ctx.ui.setWorkingMessage(`Running RLM ${record.id}...`)

        try {
          await record.promise
          await showCommandOutput(
            ctx,
            `RLM Run ${record.id}`,
            formatRecordText(summarizeRecord(record.id)),
          )
          ctx.ui.notify(`RLM run completed: ${record.id}`, 'info')
        } finally {
          ctx.ui.setWorkingMessage()
          refreshRlmRunsWidget(ctx)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`RLM command failed: ${message}`, 'error')
      }
    },
  })

  pi.registerCommand('rlm-list', {
    description:
      'Browse running and completed RLM runs, then open the selected run details.',
    handler: async (_args, ctx) => {
      try {
        const records = summarizeRecentRuns()

        if (records.length === 0) {
          ctx.ui.notify('No RLM runs found.', 'info')
          return
        }

        const options = records.map((record) => {
          const activity = record.currentActivity
            ? ` — ${shortText(record.currentActivity, 40)}`
            : ''
          return `${statusIcon(record.status)} ${record.id} [${record.status}] ${shortText(record.task)}${activity}`
        })

        const selected = await ctx.ui.select('RLM Runs', options)
        if (!selected) {
          return
        }

        const selectedIndex = options.indexOf(selected)
        const selectedRecord = records[selectedIndex]
        if (!selectedRecord) {
          throw new Error('Selected RLM run could not be resolved.')
        }

        await showCommandOutput(
          ctx,
          `RLM Run ${selectedRecord.id}`,
          formatRecordText(summarizeRecord(selectedRecord.id)),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`RLM list failed: ${message}`, 'error')
      }
    },
  })
}
