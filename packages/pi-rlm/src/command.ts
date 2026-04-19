import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent'
import { showCommandOutput } from './command-ui'
import { normalizeProvider } from './model'
import { getProjectTaskRoot } from './task-loader'
import type {
  AxTaskRegistry,
  AxTaskRunner,
  AxTaskRunRequest,
  LoadedAxTask,
} from './types'

interface ParsedListCommand {
  kind: 'list'
}

interface ParsedShowCommand {
  kind: 'show'
  taskId: string
}

interface ParsedDoctorCommand {
  kind: 'doctor'
}

interface ParsedRunCommand {
  kind: 'run'
  request: AxTaskRunRequest
}

type ParsedRlmWorkflowCommand =
  | ParsedListCommand
  | ParsedShowCommand
  | ParsedDoctorCommand
  | ParsedRunCommand

const PRIMARY_COMMAND = 'rlm-task'

export function tokenizeCommand(input: string): string[] {
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

function parseRunFlags(tokens: string[]): AxTaskRunRequest {
  if (tokens.length === 0) {
    throw new Error(
      'Usage: /rlm-task run <workflow-id> [--key value] [--query text] [--model provider/model] [--debug]',
    )
  }

  const [taskId, ...flagTokens] = tokens
  const inputs: Record<string, string> = {}
  let query: string | undefined
  let model: string | undefined
  let debug = false

  for (let index = 0; index < flagTokens.length; index += 1) {
    const token = flagTokens[index]
    if (!token?.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`)
    }

    const trimmed = token.slice(2)
    const equalsIndex = trimmed.indexOf('=')
    const key = equalsIndex === -1 ? trimmed : trimmed.slice(0, equalsIndex)
    const inlineValue =
      equalsIndex === -1 ? undefined : trimmed.slice(equalsIndex + 1)

    if (key === 'debug') {
      debug = inlineValue ? inlineValue !== 'false' : true
      continue
    }

    const nextToken = inlineValue ?? flagTokens[index + 1]
    if (!inlineValue) {
      if (!nextToken || nextToken.startsWith('--')) {
        throw new Error(`Missing value for --${key}`)
      }
      index += 1
    }

    const value = nextToken

    switch (key) {
      case 'query':
        query = value
        break
      case 'model':
        model = value
        break
      case 'json': {
        const parsed = JSON.parse(value) as Record<string, unknown>
        for (const [entryKey, entryValue] of Object.entries(parsed)) {
          inputs[entryKey] =
            typeof entryValue === 'string'
              ? entryValue
              : JSON.stringify(entryValue)
        }
        break
      }
      default:
        inputs[key] = value
        break
    }
  }

  return {
    task: taskId,
    query,
    inputs,
    model,
    debug,
  }
}

export function parseRlmWorkflowCommand(
  args: string,
): ParsedRlmWorkflowCommand {
  const tokens = tokenizeCommand(args)
  const [command = 'list', ...rest] = tokens

  switch (command) {
    case 'list':
      return { kind: 'list' }
    case 'show': {
      const taskId = rest[0]
      if (!taskId) {
        throw new Error('Usage: /rlm-task show <workflow-id>')
      }
      return { kind: 'show', taskId }
    }
    case 'doctor':
      return { kind: 'doctor' }
    case 'run':
      return { kind: 'run', request: parseRunFlags(rest) }
    default:
      return {
        kind: 'run',
        request: parseRunFlags([command, ...rest]),
      }
  }
}

export function formatTaskList(tasks: LoadedAxTask[]): string {
  return [
    '# RLM Workflows',
    '',
    ...(tasks.length > 0
      ? tasks.flatMap((task) => [
          `- ${task.id} (${task.source})`,
          `  ${task.description}`,
          ...(task.path ? [`  Path: ${task.path}`] : []),
        ])
      : ['No RLM workflows found.']),
  ].join('\n')
}

export function formatTaskDetails(task: LoadedAxTask): string {
  const inputSchema = task.task.inputSchema ?? {}
  const examples = task.task.examples ?? []

  return [
    `# RLM Workflow: ${task.id}`,
    '',
    task.description,
    '',
    `Source: ${task.source}`,
    ...(task.path ? [`Path: ${task.path}`] : []),
    ...(task.task.defaultModel
      ? [`Default model: ${task.task.defaultModel}`]
      : []),
    '',
    '## Inputs',
    ...(Object.keys(inputSchema).length > 0
      ? Object.entries(inputSchema).map(
          ([key, description]) => `- ${key}: ${description}`,
        )
      : ['- No explicit inputs declared']),
    '',
    '## Examples',
    ...(examples.length > 0
      ? examples.map((example) => `- ${example}`)
      : ['- No examples provided']),
  ].join('\n')
}

export function formatDoctorReport(args: {
  taskRoot: string
  tasks: LoadedAxTask[]
  activeModel?: { provider?: string; id?: string }
}): string {
  const activeProvider = normalizeProvider(args.activeModel?.provider)
  const activeModelSpec =
    activeProvider && args.activeModel?.id
      ? `${activeProvider}/${args.activeModel.id}`
      : 'No active model selected'

  return [
    '# RLM Workflow Doctor',
    '',
    `Task root: ${args.taskRoot}`,
    `Loaded workflows: ${args.tasks.length}`,
    `Active model: ${activeModelSpec}`,
    '',
    '## Workflows',
    ...(args.tasks.length > 0
      ? args.tasks.map((task) => `- ${task.id} (${task.source})`)
      : ['- None']),
  ].join('\n')
}

async function publishCommandOutput(
  ctx: ExtensionCommandContext,
  title: string,
  output: string,
) {
  await showCommandOutput(ctx, title, output)
}

export function registerRlmWorkflowCommand(
  pi: ExtensionAPI,
  registry: AxTaskRegistry,
  runTask: AxTaskRunner,
) {
  pi.registerCommand(PRIMARY_COMMAND, {
    description:
      'Run or inspect named RLM workflows: /rlm-task list | show <workflow> | run <workflow> | doctor',
    handler: async (args, ctx) => {
      try {
        const parsed = parseRlmWorkflowCommand(args)

        switch (parsed.kind) {
          case 'list': {
            const tasks = await registry.list(ctx.cwd)
            await publishCommandOutput(
              ctx,
              'RLM Workflow List',
              formatTaskList(tasks),
            )
            return
          }
          case 'show': {
            const task = await registry.get(ctx.cwd, parsed.taskId)
            if (!task) {
              throw new Error(`Unknown RLM workflow: ${parsed.taskId}`)
            }
            await publishCommandOutput(
              ctx,
              `RLM Workflow ${parsed.taskId}`,
              formatTaskDetails(task),
            )
            return
          }
          case 'doctor': {
            const tasks = await registry.list(ctx.cwd)
            await publishCommandOutput(
              ctx,
              'RLM Workflow Doctor',
              formatDoctorReport({
                taskRoot: getProjectTaskRoot(ctx.cwd),
                tasks,
                activeModel: ctx.model as { provider?: string; id?: string },
              }),
            )
            return
          }
          case 'run': {
            ctx.ui.setWorkingMessage(
              `Running workflow ${parsed.request.task}...`,
            )
            ctx.ui.setStatus('pi-rlm', `Workflow ${parsed.request.task}`)
            ctx.ui.notify(
              `RLM workflow started: ${parsed.request.task}`,
              'info',
            )

            try {
              const result = await runTask(parsed.request, ctx, registry)
              await publishCommandOutput(
                ctx,
                `RLM Workflow ${result.taskId}`,
                result.outputText,
              )
              ctx.ui.notify(`RLM workflow completed: ${result.taskId}`, 'info')
            } finally {
              ctx.ui.setWorkingMessage()
              ctx.ui.setStatus('pi-rlm', undefined)
            }
            return
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`RLM workflow command failed: ${message}`, 'error')
      }
    },
  })
}
