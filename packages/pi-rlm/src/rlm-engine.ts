import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  createAgentSession,
  DefaultResourceLoader,
  readOnlyTools,
  SessionManager,
} from '@mariozechner/pi-coding-agent'
import { resolveRlmModel } from './model'
import {
  formatChildOutputs,
  plannerDescription,
  solverDescription,
  synthesisDescription,
} from './rlm-prompts'
import type {
  ResolvedPiModel,
  RlmEngineOptions,
  RlmNode,
  RlmPlanResult,
  RlmRunArtifacts,
  RlmRunResult,
  RlmStartRequest,
} from './types'

interface EngineInput extends RlmStartRequest {
  runId: string
}

interface EngineState {
  nodeCounter: number
  nodesVisited: number
  maxDepthSeen: number
  events: string[]
}

export async function runRlmEngine(
  input: EngineInput,
  ctx: ExtensionContext,
  options: RlmEngineOptions = {},
): Promise<RlmRunResult> {
  const startedAt = Date.now()
  const state: EngineState = {
    nodeCounter: 0,
    nodesVisited: 0,
    maxDepthSeen: 0,
    events: [],
  }
  const signal = options.signal
  const progress = options.onProgress
  const resolveModel = options.resolveModel ?? resolveRlmModel
  const artifacts = await createArtifacts(input.runId)
  const resolvedModel = await resolveModel(ctx, input.model)

  const emit = (message: string) => {
    state.events.push(message)
    progress?.(message)
  }

  emit(`RLM run ${input.runId} started via ${resolvedModel.spec}`)
  emit(`RLM cwd: ${input.cwd}`)

  const root = await runNode(input.task, 0, [], resolvedModel)
  const final = root.result ?? '(no final output)'

  await writeFile(artifacts.treePath, JSON.stringify(root, null, 2), 'utf8')
  await writeFile(artifacts.outputPath, final, 'utf8')
  await writeFile(artifacts.eventsPath, `${state.events.join('\n')}\n`, 'utf8')

  const durationMs = Date.now() - startedAt
  return {
    runId: input.runId,
    root,
    final,
    model: resolvedModel.spec,
    artifacts,
    events: [...state.events],
    stats: {
      nodesVisited: state.nodesVisited,
      maxDepthSeen: state.maxDepthSeen,
      durationMs,
    },
  }

  async function runNode(
    task: string,
    depth: number,
    lineage: string[],
    model: ResolvedPiModel,
  ): Promise<RlmNode> {
    if (signal?.aborted) {
      throw new Error('RLM run cancelled')
    }

    const nodeId = `n${++state.nodeCounter}`
    state.nodesVisited += 1
    state.maxDepthSeen = Math.max(state.maxDepthSeen, depth)

    const node: RlmNode = {
      id: nodeId,
      task,
      depth,
      status: 'running',
      startedAt: Date.now(),
      children: [],
    }

    emit(`[${node.id}] depth=${depth} ${shortTask(task)}`)

    try {
      const normalized = normalizeTask(task)
      const forcedReason = getForcedSolveReason({
        depth,
        maxDepth: input.maxDepth,
        maxNodes: input.maxNodes,
        nodesVisited: state.nodesVisited,
        lineage,
        normalizedTask: normalized,
      })

      if (forcedReason || input.mode === 'solve') {
        node.decision = {
          action: 'solve',
          reason: forcedReason ?? 'mode=solve',
        }
        node.result = await solveNode(node, model, node.decision.reason)
        emit(`[${node.id}] solved directly`)
        node.status = 'completed'
        node.finishedAt = Date.now()
        return node
      }

      const plan = await planNode(node, model)
      node.decision = {
        action: plan.action,
        reason: plan.reason,
        subtasks: plan.subtasks,
      }
      emit(
        `[${node.id}] planner chose ${plan.action}: ${shortTask(plan.reason, 88)}`,
      )

      if (plan.action === 'solve') {
        node.result = await solveNode(node, model, plan.reason)
        emit(`[${node.id}] solved directly`)
        node.status = 'completed'
        node.finishedAt = Date.now()
        return node
      }

      const subtasks = sanitizeSubtasks(plan.subtasks ?? [], task).slice(
        0,
        input.maxBranching,
      )

      emit(`[${node.id}] decomposing into ${subtasks.length} subtasks`)

      if (subtasks.length < 2) {
        if (input.mode === 'decompose') {
          throw new Error('mode=decompose requires at least 2 valid subtasks')
        }
        node.decision = {
          action: 'solve',
          reason: 'planner returned insufficient valid subtasks',
        }
        node.result = await solveNode(node, model, node.decision.reason)
        emit(`[${node.id}] fallback to direct solve`)
        node.status = 'completed'
        node.finishedAt = Date.now()
        return node
      }

      for (const subtask of subtasks) {
        if (state.nodesVisited >= input.maxNodes) {
          break
        }
        node.children.push(
          await runNode(subtask, depth + 1, [...lineage, normalized], model),
        )
      }

      const completedChildren = node.children.filter(
        (child) => child.status === 'completed',
      )

      if (completedChildren.length === 0) {
        node.status = 'failed'
        node.error = 'No child node completed successfully'
        node.finishedAt = Date.now()
        return node
      }

      node.result = await synthesizeNode(node, model)
      emit(`[${node.id}] synthesized ${completedChildren.length} child outputs`)
      node.status = 'completed'
      node.finishedAt = Date.now()
      return node
    } catch (error) {
      node.status = signal?.aborted ? 'cancelled' : 'failed'
      node.error = error instanceof Error ? error.message : String(error)
      emit(`[${node.id}] ${node.status}: ${node.error}`)
      node.finishedAt = Date.now()
      return node
    }
  }

  async function planNode(
    node: RlmNode,
    model: ResolvedPiModel,
  ): Promise<RlmPlanResult> {
    const answer = await runPiNodePrompt(
      node,
      model,
      plannerDescription(),
      [
        `Task: ${node.task}`,
        `Depth: ${node.depth}`,
        `Max depth: ${input.maxDepth}`,
        `Max branching: ${input.maxBranching}`,
        `Remaining node budget: ${Math.max(0, input.maxNodes - state.nodesVisited)}`,
        '',
        'You are running inside the exact working directory Pi is using.',
        `Current working directory: ${input.cwd}`,
        'Use the available file/shell tools to inspect the repository when useful before deciding.',
        '',
        'Return ONLY JSON with this shape:',
        '{"action":"solve"|"decompose","reason":"...","subtasks":["..."]}',
      ].join('\n'),
    )

    const parsed = extractFirstJsonObject(answer)
    return {
      action: parsed?.action === 'decompose' ? 'decompose' : 'solve',
      reason:
        typeof parsed?.reason === 'string' && parsed.reason.trim()
          ? parsed.reason.trim()
          : 'No planner reason provided',
      subtasks: Array.isArray(parsed?.subtasks)
        ? parsed.subtasks.filter(
            (item): item is string => typeof item === 'string',
          )
        : undefined,
    }
  }

  async function solveNode(
    node: RlmNode,
    model: ResolvedPiModel,
    forceReason?: string,
  ): Promise<string> {
    return runPiNodePrompt(
      node,
      model,
      solverDescription(),
      [
        `Task: ${node.task}`,
        `Depth: ${node.depth}`,
        `Max depth: ${input.maxDepth}`,
        ...(forceReason ? [`Force reason: ${forceReason}`] : []),
        '',
        'You are running inside the exact working directory Pi is using.',
        `Current working directory: ${input.cwd}`,
        'Inspect the real repository using tools before answering when the task depends on code or files.',
        'Ground the answer in concrete files/directories when possible.',
      ].join('\n'),
    )
  }

  async function synthesizeNode(
    node: RlmNode,
    model: ResolvedPiModel,
  ): Promise<string> {
    return runPiNodePrompt(
      node,
      model,
      synthesisDescription(),
      [
        `Parent task: ${node.task}`,
        `Depth: ${node.depth}`,
        '',
        'You are running inside the exact working directory Pi is using.',
        `Current working directory: ${input.cwd}`,
        'Use repository tools if you need to verify or sharpen the synthesis.',
        '',
        'Child outputs:',
        formatChildOutputs(node.children),
      ].join('\n'),
    )
  }

  async function runPiNodePrompt(
    node: RlmNode,
    model: ResolvedPiModel,
    systemPrompt: string,
    prompt: string,
  ): Promise<string> {
    const loader = new DefaultResourceLoader({
      cwd: input.cwd,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      appendSystemPromptOverride: (base) => [
        ...base,
        '## Recursive RLM Node Instructions',
        '- You are one node in a recursive run.',
        '- You have access to the exact current working directory via Pi tools.',
        '- Use tools when the task depends on repository contents.',
        '- Stay focused on the assigned node task.',
        '- Do not mention tool limitations when you can inspect files directly.',
      ],
      systemPromptOverride: () => systemPrompt,
    })
    await loader.reload()

    const { session } = await createAgentSession({
      cwd: input.cwd,
      model: model.model,
      modelRegistry: ctx.modelRegistry,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      tools: readOnlyTools,
    })

    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        emit(`[${node.id}] using ${event.toolName}`)
      }
    })

    try {
      await session.prompt(prompt, { source: 'extension' })
      const text = extractLastAssistantText(session.messages as unknown[])
      if (!text.trim()) {
        throw new Error('Model returned an empty response')
      }
      return text.trim()
    } finally {
      unsubscribe()
      session.dispose()
    }
  }
}

async function createArtifacts(runId: string): Promise<RlmRunArtifacts> {
  const dir = join(tmpdir(), 'pi-rlm-runs', runId)
  await mkdir(dir, { recursive: true })
  return {
    dir,
    eventsPath: join(dir, 'events.log'),
    treePath: join(dir, 'tree.json'),
    outputPath: join(dir, 'output.md'),
  }
}

function extractLastAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object') {
      continue
    }

    const role = Reflect.get(message, 'role')
    if (role !== 'assistant') {
      continue
    }

    const content = Reflect.get(message, 'content')
    const text = extractTextFromContent(content)
    if (text.trim()) {
      return text
    }
  }

  return ''
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return ''
      }
      return Reflect.get(entry, 'type') === 'text'
        ? String(Reflect.get(entry, 'text') ?? '')
        : ''
    })
    .join('')
}

function extractFirstJsonObject(
  text: string,
): Record<string, unknown> | undefined {
  const start = text.indexOf('{')
  if (start === -1) {
    return undefined
  }

  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as Record<
            string,
            unknown
          >
        } catch {
          return undefined
        }
      }
    }
  }

  return undefined
}

function sanitizeSubtasks(subtasks: string[], parentTask: string): string[] {
  const seen = new Set<string>()
  const normalizedParent = normalizeTask(parentTask)
  const result: string[] = []

  for (const subtask of subtasks) {
    const trimmed = subtask.trim()
    if (!trimmed) {
      continue
    }
    const normalized = normalizeTask(trimmed)
    if (
      !normalized ||
      normalized === normalizedParent ||
      seen.has(normalized)
    ) {
      continue
    }
    seen.add(normalized)
    result.push(trimmed)
  }

  return result
}

function getForcedSolveReason(args: {
  depth: number
  maxDepth: number
  maxNodes: number
  nodesVisited: number
  lineage: string[]
  normalizedTask: string
}): string | undefined {
  if (args.depth >= args.maxDepth) {
    return 'maxDepth reached'
  }

  if (args.nodesVisited >= args.maxNodes) {
    return 'maxNodes reached'
  }

  if (args.lineage.includes(args.normalizedTask)) {
    return 'cycle detected'
  }

  return undefined
}

function normalizeTask(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function shortTask(value: string, maxLength = 72): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trimEnd()}…`
}
