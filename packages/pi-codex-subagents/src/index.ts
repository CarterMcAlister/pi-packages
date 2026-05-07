import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import { type Static, Type } from 'typebox'

const EXTENSION_NAME = 'pi-codex-subagents'
const REGISTRY_ENV = 'PI_CODEX_SUBAGENTS_REGISTRY_DIR'
const AGENT_PATH_ENV = 'PI_CODEX_AGENT_PATH'
const DEFAULT_WAIT_TIMEOUT_MS = 60_000
const MAX_WAIT_TIMEOUT_MS = 600_000
const POLL_INTERVAL_MS = 500
const AGENT_OVERLAY_SHORTCUT = 'alt+shift+a'
const OVERLAY_REFRESH_MS = 1000
const OVERLAY_MAX_SOURCE_CHARS = 200_000

interface TuiLike {
  terminal?: { columns?: number; rows?: number }
  requestRender(): void
}

interface ComponentLike {
  render(width: number): string[]
  handleInput?(data: string): void
  invalidate(): void
  dispose?(): void
}

const spawnAgentSchema = Type.Object(
  {
    task_name: Type.String({
      description:
        'Task name for the new agent. Use lowercase letters, digits, and underscores.',
    }),
    message: Type.String({
      description: 'Initial plain-text task for the new agent.',
    }),
    agent_type: Type.Optional(
      Type.String({
        description:
          'Optional role hint for the spawned Pi agent. Full-history forks reject this override for Codex compatibility.',
      }),
    ),
    fork_turns: Type.Optional(
      Type.String({
        description:
          'Optional number of turns to fork. Defaults to `all`. Use `none`, `all`, or a positive integer string such as `3`.',
      }),
    ),
    model: Type.Optional(
      Type.String({
        description:
          'Optional model override for the new agent. Leave unset to inherit the same model as the parent where Pi can do so.',
      }),
    ),
    reasoning_effort: Type.Optional(
      Type.String({
        description:
          'Optional reasoning effort override for the new agent. Maps to Pi `--thinking` when provided.',
      }),
    ),
  },
  { additionalProperties: false },
)

const messageSchema = Type.Object(
  {
    target: Type.String({
      description:
        'Relative or canonical task name to message (from spawn_agent).',
    }),
    message: Type.String({
      description: 'Message text to send to the target agent.',
    }),
  },
  { additionalProperties: false },
)

const waitAgentSchema = Type.Object(
  {
    timeout_ms: Type.Optional(
      Type.Number({
        description: `Optional timeout in milliseconds. Defaults to ${DEFAULT_WAIT_TIMEOUT_MS}, min 1, max ${MAX_WAIT_TIMEOUT_MS}.`,
      }),
    ),
  },
  { additionalProperties: false },
)

const closeAgentSchema = Type.Object(
  {
    target: Type.String({
      description:
        'Agent id or canonical task name to close (from spawn_agent).',
    }),
  },
  { additionalProperties: false },
)

const listAgentsSchema = Type.Object(
  {
    path_prefix: Type.Optional(
      Type.String({
        description:
          'Optional task-path prefix (not ending with trailing slash). Accepts the same relative or absolute task-path syntax.',
      }),
    ),
  },
  { additionalProperties: false },
)

type SpawnAgentArgs = Static<typeof spawnAgentSchema>
type MessageArgs = Static<typeof messageSchema>
type WaitAgentArgs = Static<typeof waitAgentSchema>
type CloseAgentArgs = Static<typeof closeAgentSchema>
type ListAgentsArgs = Static<typeof listAgentsSchema>

type AgentStatus =
  | 'pending_init'
  | 'running'
  | 'interrupted'
  | 'shutdown'
  | 'not_found'
  | { completed: string | null }
  | { errored: string }

interface QueuedMessage {
  message: string
  triggerTurn: boolean
  createdAt: string
}

interface AgentRecord {
  agent_name: string
  requested_task_name: string
  run_id: string
  pid?: number
  status: AgentStatus
  last_task_message: string | null
  cwd: string
  output_path: string
  stderr_path: string
  session_dir: string
  session_file?: string
  agent_type?: string
  model?: string
  reasoning_effort?: string
  fork_turns: string
  started_at: string
  updated_at: string
  mailbox_update: boolean
  queued_messages: QueuedMessage[]
  closing?: boolean
}

interface EventBus {
  on(event: string, handler: (data: unknown) => void): () => void
  emit(event: string, data?: unknown): void
}

type RpcReply<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }

interface Registry {
  version: 1
  root_agent_path: string
  agents: AgentRecord[]
}

interface SpawnRuntimeOptions {
  ctx: ExtensionContext
  registryDir: string
  currentAgentPath: string
  canonicalTaskName: string
  requestedTaskName: string
  message: string
  queuedMessages?: QueuedMessage[]
  agentType?: string
  model?: string
  reasoningEffort?: string
  forkTurns: string
  sessionFile?: string
  reuseSessionDir?: string
  runId?: string
}

function textResult(
  text: string,
  details: Record<string, unknown> = {},
  isError = false,
) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
    ...(isError ? { isError: true } : {}),
  }
}

function outputResult(details: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(details) }],
    details,
  }
}

function plainTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') {
        return record.text
      }
      if (record.type === 'toolCall') {
        const name = typeof record.name === 'string' ? record.name : 'tool'
        return `[tool call: ${name}]`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function formatSessionEntry(line: string): string[] {
  try {
    const entry = JSON.parse(line) as Record<string, unknown>
    if (entry.type === 'message') {
      const message = entry.message as Record<string, unknown> | undefined
      const role = typeof message?.role === 'string' ? message.role : 'message'
      const content = plainTextContent(message?.content).trim()
      if (role === 'toolResult') {
        const toolName =
          typeof message?.toolName === 'string' ? message.toolName : 'tool'
        return [
          `toolResult ${toolName}:`,
          ...(content ? content.split('\n') : ['(no output)']),
        ]
      }
      return [`${role}:`, ...(content ? content.split('\n') : ['(no text)'])]
    }
    if (entry.type === 'model_change') {
      return [
        `model: ${String(entry.provider ?? '')}/${String(entry.modelId ?? '')}`,
      ]
    }
    if (entry.type === 'thinking_level_change') {
      return [`thinking: ${String(entry.thinkingLevel ?? '')}`]
    }
    if (entry.type === 'compaction') return ['[context compacted]']
    if (entry.type === 'session') return [`session: ${String(entry.id ?? '')}`]
    return [line]
  } catch {
    return [line]
  }
}

function tailFile(
  filePath: string | undefined,
  maxChars = OVERLAY_MAX_SOURCE_CHARS,
): string {
  if (!filePath || !existsSync(filePath)) return ''
  const raw = readFileSync(filePath, 'utf-8')
  return raw.length > maxChars ? raw.slice(raw.length - maxChars) : raw
}

function formatSessionFile(filePath: string | undefined): string[] {
  const raw = tailFile(filePath)
  if (!raw.trim()) return []
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .flatMap(formatSessionEntry)
}

function wrapLine(line: string, width: number): string[] {
  const safeWidth = Math.max(1, width)
  const expanded = line.replaceAll('\t', '  ')
  if (expanded.length <= safeWidth) return [expanded]
  const chunks: string[] = []
  for (let index = 0; index < expanded.length; index += safeWidth) {
    chunks.push(expanded.slice(index, index + safeWidth))
  }
  return chunks
}

function fitLine(line: string, width: number): string {
  if (width <= 0) return ''
  if (line.length <= width) return line.padEnd(width)
  return `${line.slice(0, Math.max(0, width - 1))}…`
}

function statusLabel(record: AgentRecord): string {
  return `${record.agent_name} (${statusSummary(record.status)})`
}

class AgentSessionOverlay implements ComponentLike {
  private scrollOffset = 0
  private readonly timer: ReturnType<typeof setInterval>
  private readonly tui: TuiLike
  private readonly registryDir: string
  private readonly agentName: string
  private readonly done: () => void

  constructor(
    tui: TuiLike,
    registryDir: string,
    agentName: string,
    done: () => void,
  ) {
    this.tui = tui
    this.registryDir = registryDir
    this.agentName = agentName
    this.done = done
    this.timer = setInterval(() => this.tui.requestRender(), OVERLAY_REFRESH_MS)
  }

  invalidate(): void {}

  dispose(): void {
    clearInterval(this.timer)
  }

  handleInput(data: string): void {
    if (
      data === 'q' ||
      data === 'Q' ||
      data === '\u001b' ||
      data === '\u0003'
    ) {
      this.done()
      return
    }
    if (data === '\u001b[A') this.scrollOffset += 1
    else if (data === '\u001b[B')
      this.scrollOffset = Math.max(0, this.scrollOffset - 1)
    else if (data === '\u001b[5~') this.scrollOffset += 10
    else if (data === '\u001b[6~')
      this.scrollOffset = Math.max(0, this.scrollOffset - 10)
    else if (data === '\u001b[F' || data === '\u001b[4~') this.scrollOffset = 0
    this.tui.requestRender()
  }

  render(width: number): string[] {
    const outerWidth = Math.max(40, width)
    const innerWidth = Math.max(10, outerWidth - 4)
    const terminalRows = this.tui.terminal?.rows ?? 40
    const maxBodyLines = Math.max(8, Math.floor(terminalRows * 0.65) - 5)
    const registry = reconcileRegistry(this.registryDir)
    const record = registry.agents.find(
      (agent) => agent.agent_name === this.agentName,
    )
    if (!record) {
      return this.frame(outerWidth, [
        'Agent no longer exists.',
        'Press q or Esc to close.',
      ])
    }

    const sessionFile =
      record.session_file ?? findNewestSessionFile(record.session_dir)
    const sessionLines = formatSessionFile(sessionFile)
    const stdout = tailFile(record.output_path, 40_000).trim()
    const stderr = tailFile(record.stderr_path, 20_000).trim()
    const body = [
      `Agent: ${record.agent_name}`,
      `Status: ${statusSummary(record.status)}${record.pid ? ` · pid ${record.pid}` : ''}`,
      `Task: ${record.last_task_message ?? '(none)'}`,
      sessionFile
        ? `Session: ${sessionFile}`
        : `Session: waiting for Pi to create a session file in ${record.session_dir}`,
      `Stdout: ${record.output_path}`,
      stderr ? `Stderr: ${record.stderr_path}` : undefined,
      '',
      'Session transcript:',
      ...(sessionLines.length
        ? sessionLines
        : [
            '(no session messages yet; the agent may still be starting or streaming)',
          ]),
      ...(stdout ? ['', 'stdout:', ...stdout.split('\n')] : []),
      ...(stderr ? ['', 'stderr:', ...stderr.split('\n')] : []),
    ].filter((line): line is string => line !== undefined)
    const wrapped = body.flatMap((line) => wrapLine(line, innerWidth))
    const maxScroll = Math.max(0, wrapped.length - maxBodyLines)
    this.scrollOffset = Math.min(this.scrollOffset, maxScroll)
    const start = Math.max(0, wrapped.length - maxBodyLines - this.scrollOffset)
    const visible = wrapped.slice(start, start + maxBodyLines)
    const footer = `q/Esc close · ↑/↓ scroll · PgUp/PgDn page · ${this.scrollOffset > 0 ? `+${this.scrollOffset} from bottom` : 'live tail'}`
    return this.frame(outerWidth, [...visible, '', footer])
  }

  private frame(width: number, body: string[]): string[] {
    const innerWidth = Math.max(1, width - 4)
    const top = `╭${'─'.repeat(width - 2)}╮`
    const bottom = `╰${'─'.repeat(width - 2)}╯`
    return [
      top,
      `│ ${fitLine('Codex Subagent Session', innerWidth)} │`,
      `├${'─'.repeat(width - 2)}┤`,
      ...body.map((line) => `│ ${fitLine(line, innerWidth)} │`),
      bottom,
    ]
  }
}

function extensionRoot(): string {
  return path.join(homedir(), '.pi', 'agent', 'extensions', EXTENSION_NAME)
}

function safePart(value: string): string {
  return (
    value.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'session'
  )
}

function resolveRegistryDir(ctx: ExtensionContext): string {
  const envDir = process.env[REGISTRY_ENV]
  if (envDir) return envDir
  return path.join(
    extensionRoot(),
    'registries',
    safePart(ctx.sessionManager.getSessionId()),
  )
}

function registryPath(registryDir: string): string {
  return path.join(registryDir, 'registry.json')
}

function ensureRegistryDir(registryDir: string): void {
  mkdirSync(registryDir, { recursive: true })
  mkdirSync(path.join(registryDir, 'runs'), { recursive: true })
}

function readRegistry(registryDir: string): Registry {
  ensureRegistryDir(registryDir)
  const file = registryPath(registryDir)
  if (!existsSync(file)) {
    return { version: 1, root_agent_path: '/root', agents: [] }
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Registry
    return {
      version: 1,
      root_agent_path: parsed.root_agent_path || '/root',
      agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    }
  } catch {
    return { version: 1, root_agent_path: '/root', agents: [] }
  }
}

function writeRegistry(registryDir: string, registry: Registry): void {
  ensureRegistryDir(registryDir)
  const file = registryPath(registryDir)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`)
  renameSync(tmp, file)
}

function updateRegistry(
  registryDir: string,
  update: (registry: Registry) => void,
): Registry {
  const registry = readRegistry(registryDir)
  update(registry)
  writeRegistry(registryDir, registry)
  return registry
}

function currentAgentPath(): string {
  return normalizeCanonicalPath(process.env[AGENT_PATH_ENV] || '/root')
}

function normalizeCanonicalPath(value: string): string {
  const parts = value
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return '/root'
  if (parts[0] !== 'root') parts.unshift('root')
  return `/${parts.join('/')}`
}

function canonicalTaskName(parentPath: string, taskName: string): string {
  const trimmed = taskName.trim()
  if (!trimmed) throw new Error('task_name must not be empty')
  if (trimmed.startsWith('/')) return normalizeCanonicalPath(trimmed)
  const safeName = trimmed
    .replace(/[^a-zA-Z0-9_/-]+/g, '_')
    .replace(/^\/+|\/+$/g, '')
  if (!safeName)
    throw new Error('task_name must contain at least one valid path character')
  return normalizeCanonicalPath(`${parentPath}/${safeName}`)
}

function parseForkTurns(value: string | undefined): string {
  const forkTurns = value?.trim() || 'all'
  if (forkTurns.toLowerCase() === 'none') return 'none'
  if (forkTurns.toLowerCase() === 'all') return 'all'
  if (/^[1-9][0-9]*$/.test(forkTurns)) return forkTurns
  throw new Error(
    'fork_turns must be `none`, `all`, or a positive integer string',
  )
}

function isFullHistoryFork(forkTurns: string): boolean {
  return forkTurns.toLowerCase() === 'all'
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1]
  const isBunVirtualScript = currentScript?.startsWith('/$bunfs/root/')
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] }
  }

  const execName = path.basename(process.execPath).toLowerCase()
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName)
  if (!isGenericRuntime) return { command: process.execPath, args }
  return { command: 'pi', args }
}

function findNewestSessionFile(sessionDir: string): string | undefined {
  if (!existsSync(sessionDir)) return undefined
  const candidates: Array<{ file: string; mtimeMs: number }> = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(filePath)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        candidates.push({ file: filePath, mtimeMs: statSync(filePath).mtimeMs })
      }
    }
  }
  visit(sessionDir)
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return candidates[0]?.file
}

function isTerminalStatus(status: AgentStatus): boolean {
  return (
    status === 'interrupted' ||
    status === 'shutdown' ||
    status === 'not_found' ||
    (typeof status === 'object' &&
      ('completed' in status || 'errored' in status))
  )
}

function statusSummary(status: AgentStatus): string {
  if (typeof status === 'string') return status
  if ('completed' in status) return 'completed'
  return 'errored'
}

function resolveTarget(
  registry: Registry,
  currentPath: string,
  target: string,
): AgentRecord | undefined {
  const trimmed = target.trim()
  if (!trimmed) return undefined
  const candidates = trimmed.startsWith('/')
    ? [normalizeCanonicalPath(trimmed)]
    : [
        normalizeCanonicalPath(`${currentPath}/${trimmed}`),
        normalizeCanonicalPath(`/root/${trimmed}`),
      ]
  for (const candidate of candidates) {
    const record = registry.agents.find(
      (agent) => agent.agent_name === candidate,
    )
    if (record) return record
  }
  const suffix = `/${trimmed}`
  const suffixMatches = registry.agents.filter((agent) =>
    agent.agent_name.endsWith(suffix),
  )
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined
}

function processAlive(pid: number | undefined): boolean {
  if (typeof pid !== 'number') return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as NodeJS.ErrnoException).code
        : undefined
    return code === 'EPERM'
  }
}

function buildPrompt(options: SpawnRuntimeOptions): string {
  const queued = options.queuedMessages ?? []
  const queuedText = queued.length
    ? [
        'Queued messages delivered before this turn:',
        ...queued.map((entry, index) => `${index + 1}. ${entry.message}`),
        '',
      ].join('\n')
    : ''
  const forkNote = /^[1-9][0-9]*$/.test(options.forkTurns)
    ? `The supervisor requested fork_turns=${options.forkTurns}. Pi's CLI does not expose partial-turn forks, so this compatibility layer uses the available saved-session context when possible.\n\n`
    : ''
  return [
    `You are a Codex MultiAgentV2-compatible Pi subagent named ${options.canonicalTaskName}.`,
    'Work on the supervisor task below and finish with a concise final answer. You may use the available tools, including subagent tools, if needed.',
    options.agentType
      ? `Requested agent_type: ${options.agentType}`
      : undefined,
    '',
    forkNote.trim() || undefined,
    queuedText.trim() || undefined,
    'Supervisor task:',
    options.message,
  ]
    .filter((line): line is string => line !== undefined && line.length > 0)
    .join('\n')
}

function spawnRuntime(options: SpawnRuntimeOptions): AgentRecord {
  const runId =
    options.runId ??
    safePart(
      options.canonicalTaskName.split('/').filter(Boolean).at(-1) || 'agent',
    )
  const runDir = path.join(options.registryDir, 'runs', runId)
  const sessionDir = options.reuseSessionDir ?? path.join(runDir, 'sessions')
  mkdirSync(runDir, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })

  const outputPath = path.join(runDir, 'stdout.log')
  const stderrPath = path.join(runDir, 'stderr.log')
  const prompt = buildPrompt(options)
  const promptPath = path.join(runDir, 'prompt.md')
  writeFileSync(promptPath, prompt)

  const args = ['--mode', 'text', '--session-dir', sessionDir]
  const forkTurns = options.forkTurns.toLowerCase()
  const parentSessionFile = options.ctx.sessionManager.getSessionFile()
  if (options.sessionFile) {
    args.push('--session', options.sessionFile)
  } else if (forkTurns !== 'none' && parentSessionFile) {
    args.push('--fork', parentSessionFile)
  }
  const effectiveModel = options.model ?? options.ctx.model?.id
  if (effectiveModel) args.push('--model', effectiveModel)
  if (options.reasoningEffort) args.push('--thinking', options.reasoningEffort)
  if (options.agentType) {
    args.push(
      '--append-system-prompt',
      `You are acting as the requested subagent type: ${options.agentType}.`,
    )
  }
  args.push(`@${promptPath}`)

  const invocation = getPiInvocation(args)
  const out = createWriteStream(outputPath, { flags: 'a' })
  const err = createWriteStream(stderrPath, { flags: 'a' })
  const child = spawn(invocation.command, invocation.args, {
    cwd: options.ctx.cwd,
    env: {
      ...process.env,
      [REGISTRY_ENV]: options.registryDir,
      [AGENT_PATH_ENV]: options.canonicalTaskName,
    },
  }) as ChildProcessWithoutNullStreams
  child.stdout.pipe(out)
  child.stderr.pipe(err)

  const now = new Date().toISOString()
  const record: AgentRecord = {
    agent_name: options.canonicalTaskName,
    requested_task_name: options.requestedTaskName,
    run_id: runId,
    pid: child.pid,
    status: 'running',
    last_task_message: options.message,
    cwd: options.ctx.cwd,
    output_path: outputPath,
    stderr_path: stderrPath,
    session_dir: sessionDir,
    ...(options.agentType ? { agent_type: options.agentType } : {}),
    ...(effectiveModel ? { model: effectiveModel } : {}),
    ...(options.reasoningEffort
      ? { reasoning_effort: options.reasoningEffort }
      : {}),
    fork_turns: options.forkTurns,
    started_at: now,
    updated_at: now,
    mailbox_update: false,
    queued_messages: [],
  }

  updateRegistry(options.registryDir, (registry) => {
    const index = registry.agents.findIndex(
      (agent) => agent.agent_name === options.canonicalTaskName,
    )
    if (index >= 0)
      registry.agents[index] = { ...registry.agents[index], ...record }
    else registry.agents.push(record)
  })

  child.on('exit', (code, signal) => {
    out.end()
    err.end()
    const stdout = existsSync(outputPath)
      ? readFileSync(outputPath, 'utf-8').trim()
      : ''
    const stderr = existsSync(stderrPath)
      ? readFileSync(stderrPath, 'utf-8').trim()
      : ''
    const sessionFile = findNewestSessionFile(sessionDir)
    let followUpToSpawn: QueuedMessage | undefined
    updateRegistry(options.registryDir, (registry) => {
      const existing = registry.agents.find(
        (agent) => agent.agent_name === options.canonicalTaskName,
      )
      if (!existing) return
      const terminalStatus: AgentStatus = existing.closing
        ? 'shutdown'
        : code === 0
          ? { completed: stdout || null }
          : {
              errored:
                stderr ||
                stdout ||
                `Agent exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`,
            }
      existing.status = terminalStatus
      existing.pid = undefined
      existing.updated_at = new Date().toISOString()
      existing.mailbox_update = true
      if (sessionFile) existing.session_file = sessionFile
      followUpToSpawn = existing.queued_messages.find(
        (message) => message.triggerTurn,
      )
      if (followUpToSpawn) {
        existing.queued_messages = existing.queued_messages.filter(
          (message) => message !== followUpToSpawn,
        )
      }
    })
    if (followUpToSpawn) {
      try {
        spawnRuntime({
          ...options,
          message: followUpToSpawn.message,
          queuedMessages: [],
          sessionFile,
          reuseSessionDir: sessionDir,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updateRegistry(options.registryDir, (registry) => {
          const existing = registry.agents.find(
            (agent) => agent.agent_name === options.canonicalTaskName,
          )
          if (!existing) return
          existing.status = {
            errored: `Failed to start queued follow-up: ${message}`,
          }
          existing.updated_at = new Date().toISOString()
          existing.mailbox_update = true
        })
      }
    }
  })

  child.on('error', (error) => {
    updateRegistry(options.registryDir, (registry) => {
      const existing = registry.agents.find(
        (agent) => agent.agent_name === options.canonicalTaskName,
      )
      if (!existing) return
      existing.status = { errored: error.message }
      existing.pid = undefined
      existing.updated_at = new Date().toISOString()
      existing.mailbox_update = true
    })
  })

  return record
}

function reconcileRegistry(registryDir: string): Registry {
  return updateRegistry(registryDir, (registry) => {
    for (const agent of registry.agents) {
      if (agent.status === 'running' && !processAlive(agent.pid)) {
        const stdout = existsSync(agent.output_path)
          ? readFileSync(agent.output_path, 'utf-8').trim()
          : ''
        const stderr = existsSync(agent.stderr_path)
          ? readFileSync(agent.stderr_path, 'utf-8').trim()
          : ''
        agent.status = stdout
          ? { completed: stdout }
          : stderr
            ? { errored: stderr }
            : 'shutdown'
        agent.pid = undefined
        agent.updated_at = new Date().toISOString()
        agent.mailbox_update = true
        const sessionFile = findNewestSessionFile(agent.session_dir)
        if (sessionFile) agent.session_file = sessionFile
      }
    }
  })
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function consumeMailboxUpdates(registryDir: string): AgentRecord[] {
  let updates: AgentRecord[] = []
  updateRegistry(registryDir, (registry) => {
    updates = registry.agents.filter((agent) => agent.mailbox_update)
    for (const agent of updates) agent.mailbox_update = false
  })
  return updates
}

function clampTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MS
  if (value <= 0) throw new Error('timeout_ms must be greater than zero')
  return Math.max(1, Math.min(MAX_WAIT_TIMEOUT_MS, value))
}

function listAgentPayload(registryDir: string, pathPrefix?: string) {
  const registry = reconcileRegistry(registryDir)
  const prefix = pathPrefix ? normalizeCanonicalPath(pathPrefix) : undefined
  return registry.agents
    .filter(
      (agent) =>
        !prefix ||
        agent.agent_name === prefix ||
        agent.agent_name.startsWith(`${prefix}/`),
    )
    .map((agent) => ({
      agent_name: agent.agent_name,
      agent_status: agent.status,
      last_task_message: agent.last_task_message,
    }))
}

export default function registerCodexSubagents(pi: ExtensionAPI): void {
  const eventBus = (pi as ExtensionAPI & { events?: EventBus }).events
  let latestCtx: ExtensionContext | undefined

  const rememberCtx = (ctx: ExtensionContext) => {
    latestCtx = ctx
  }

  pi.on('before_agent_start', async (_event, ctx) => rememberCtx(ctx))
  pi.on('tool_execution_start', async (_event, ctx) => rememberCtx(ctx))

  function rpcReply<T>(
    name: string,
    requestId: string,
    reply: RpcReply<T>,
  ): void {
    eventBus?.emit(`pi-codex-subagents:rpc:${name}:reply:${requestId}`, reply)
  }

  function registerRpcHandler<TParams extends Record<string, unknown>, TData>(
    name: string,
    handler: (params: TParams, ctx: ExtensionContext) => Promise<TData> | TData,
  ): void {
    eventBus?.on(`pi-codex-subagents:rpc:${name}`, async (raw) => {
      const params = raw as TParams & { requestId?: string }
      const requestId = params.requestId
      if (!requestId) return
      if (!latestCtx) {
        rpcReply(name, requestId, {
          success: false,
          error: 'No active Pi extension context is available yet.',
        })
        return
      }
      try {
        rpcReply(name, requestId, {
          success: true,
          data: await handler(params, latestCtx),
        })
      } catch (error) {
        rpcReply(name, requestId, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }

  registerRpcHandler<
    SpawnAgentArgs,
    { task_name: string; nickname: string | null }
  >('spawn', (params, ctx) => {
    const forkTurns = parseForkTurns(params.fork_turns)
    if (
      isFullHistoryFork(forkTurns) &&
      (params.agent_type || params.model || params.reasoning_effort)
    ) {
      throw new Error(
        'Full-history forks reject agent_type, model, and reasoning_effort overrides. Use fork_turns="none" or omit those overrides.',
      )
    }
    const registryDir = resolveRegistryDir(ctx)
    const parentPath = currentAgentPath()
    const canonical = canonicalTaskName(parentPath, params.task_name)
    const record = spawnRuntime({
      ctx,
      registryDir,
      currentAgentPath: parentPath,
      canonicalTaskName: canonical,
      requestedTaskName: params.task_name,
      message: params.message,
      agentType: params.agent_type,
      model: params.model,
      reasoningEffort: params.reasoning_effort,
      forkTurns,
      runId: safePart(canonical.split('/').filter(Boolean).join('__')),
    })
    return { task_name: record.agent_name, nickname: null }
  })

  registerRpcHandler<
    ListAgentsArgs,
    { agents: ReturnType<typeof listAgentPayload> }
  >('list', (params, ctx) => ({
    agents: listAgentPayload(resolveRegistryDir(ctx), params.path_prefix),
  }))

  registerRpcHandler<WaitAgentArgs, { message: string; timed_out: boolean }>(
    'wait',
    async (params, ctx) => {
      const timeoutMs = clampTimeout(params.timeout_ms)
      const registryDir = resolveRegistryDir(ctx)
      const deadline = Date.now() + timeoutMs
      while (Date.now() <= deadline) {
        reconcileRegistry(registryDir)
        const updates = consumeMailboxUpdates(registryDir)
        if (updates.length > 0) {
          const names = updates
            .map(
              (agent) => `${agent.agent_name} (${statusSummary(agent.status)})`,
            )
            .join(', ')
          return {
            message: `Wait completed. Agents with updates: ${names}.`,
            timed_out: false,
          }
        }
        await sleep(
          Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())),
        )
      }
      return { message: 'Wait timed out.', timed_out: true }
    },
  )

  registerRpcHandler<CloseAgentArgs, { previous_status: AgentStatus }>(
    'close',
    (params, ctx) => {
      const registryDir = resolveRegistryDir(ctx)
      const registry = reconcileRegistry(registryDir)
      const target = resolveTarget(registry, currentAgentPath(), params.target)
      if (!target) return { previous_status: 'not_found' }
      const previousStatus = target.status
      updateRegistry(registryDir, (current) => {
        for (const record of current.agents) {
          if (
            record.agent_name !== target.agent_name &&
            !record.agent_name.startsWith(`${target.agent_name}/`)
          ) {
            continue
          }
          record.closing = true
          const pid = record.pid
          if (
            record.status === 'running' &&
            typeof pid === 'number' &&
            processAlive(pid)
          ) {
            try {
              process.kill(pid, 'SIGTERM')
            } catch {
              // Best effort close.
            }
          }
          if (!isTerminalStatus(record.status)) record.status = 'shutdown'
          record.updated_at = new Date().toISOString()
          record.mailbox_update = true
        }
      })
      return { previous_status: previousStatus }
    },
  )

  pi.registerShortcut(AGENT_OVERLAY_SHORTCUT, {
    description: 'Open a Codex subagent session overlay',
    handler: async (ctx) => {
      if (!ctx.hasUI) return
      const registryDir = resolveRegistryDir(ctx)
      const registry = reconcileRegistry(registryDir)
      const agents = [...registry.agents].sort((left, right) => {
        if (left.status === 'running' && right.status !== 'running') return -1
        if (right.status === 'running' && left.status !== 'running') return 1
        return right.updated_at.localeCompare(left.updated_at)
      })
      if (agents.length === 0) {
        ctx.ui.notify(
          'No Codex subagents have been spawned in this session.',
          'info',
        )
        return
      }
      const labels = agents.map(statusLabel)
      const selected = await ctx.ui.select('Open subagent session', labels)
      if (!selected) return
      const selectedIndex = labels.indexOf(selected)
      const agent = agents[selectedIndex]
      if (!agent) return
      await ctx.ui.custom<void>(
        (tui, _theme, _keybindings, done) =>
          new AgentSessionOverlay(tui, registryDir, agent.agent_name, done),
        {
          overlay: true,
          overlayOptions: {
            anchor: 'center',
            width: '95%',
            maxHeight: '80%',
            margin: 1,
          },
        },
      )
    },
  })

  pi.registerTool({
    name: 'spawn_agent',
    label: 'Spawn Agent',
    description: `Spawns an agent to work on the specified task. If your current task is \`/root/task1\` and you spawn_agent with task_name "task_3" the agent will have canonical task name \`/root/task1/task_3\`.
You are then able to refer to this agent as \`task_3\` or \`/root/task1/task_3\` interchangeably. The spawned agent has the same Pi tool surface and can spawn its own subagents. Spawned agents inherit the current saved session with \`fork_turns: "all"\` where Pi exposes a session file. Its final answer is recorded as a mailbox update and can be observed with wait_agent, list_agents, or status inspection.`,
    parameters: spawnAgentSchema,
    async execute(_id, params: SpawnAgentArgs, _signal, _onUpdate, ctx) {
      try {
        const forkTurns = parseForkTurns(params.fork_turns)
        if (
          isFullHistoryFork(forkTurns) &&
          (params.agent_type || params.model || params.reasoning_effort)
        ) {
          return textResult(
            'Full-history forks reject agent_type, model, and reasoning_effort overrides. Use fork_turns="none" or omit those overrides.',
            {},
            true,
          )
        }
        const registryDir = resolveRegistryDir(ctx)
        const parentPath = currentAgentPath()
        const canonical = canonicalTaskName(parentPath, params.task_name)
        const record = spawnRuntime({
          ctx,
          registryDir,
          currentAgentPath: parentPath,
          canonicalTaskName: canonical,
          requestedTaskName: params.task_name,
          message: params.message,
          agentType: params.agent_type,
          model: params.model,
          reasoningEffort: params.reasoning_effort,
          forkTurns,
          runId: safePart(canonical.split('/').filter(Boolean).join('__')),
        })
        return outputResult({ task_name: record.agent_name, nickname: null })
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error),
          {},
          true,
        )
      }
    },
  })

  pi.registerTool({
    name: 'send_message',
    label: 'Send Message',
    description:
      'Send a message to an existing agent. The message will be delivered promptly when the target next processes queued messages. Does not trigger a new turn.',
    parameters: messageSchema,
    async execute(_id, params: MessageArgs, _signal, _onUpdate, ctx) {
      try {
        const registryDir = resolveRegistryDir(ctx)
        const registry = reconcileRegistry(registryDir)
        const target = resolveTarget(
          registry,
          currentAgentPath(),
          params.target,
        )
        if (!target) return textResult('target agent not found', {}, true)
        updateRegistry(registryDir, (current) => {
          const record = current.agents.find(
            (agent) => agent.agent_name === target.agent_name,
          )
          if (!record) return
          record.queued_messages.push({
            message: params.message,
            triggerTurn: false,
            createdAt: new Date().toISOString(),
          })
          record.updated_at = new Date().toISOString()
        })
        return textResult('')
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error),
          {},
          true,
        )
      }
    },
  })

  pi.registerTool({
    name: 'followup_task',
    label: 'Follow-Up Task',
    description:
      "Send a message to an existing non-root target agent and trigger a turn in that target. If the target is currently mid-turn, the message is queued and will be used to start the target's next turn after the current turn completes.",
    parameters: messageSchema,
    async execute(_id, params: MessageArgs, _signal, _onUpdate, ctx) {
      try {
        if (normalizeCanonicalPath(params.target) === '/root')
          return textResult(
            "Tasks can't be assigned to the root agent",
            {},
            true,
          )
        const registryDir = resolveRegistryDir(ctx)
        const registry = reconcileRegistry(registryDir)
        const target = resolveTarget(
          registry,
          currentAgentPath(),
          params.target,
        )
        if (!target) return textResult('target agent not found', {}, true)
        if (target.agent_name === '/root')
          return textResult(
            "Tasks can't be assigned to the root agent",
            {},
            true,
          )
        if (target.status === 'running') {
          updateRegistry(registryDir, (current) => {
            const record = current.agents.find(
              (agent) => agent.agent_name === target.agent_name,
            )
            if (!record) return
            record.queued_messages.push({
              message: params.message,
              triggerTurn: true,
              createdAt: new Date().toISOString(),
            })
            record.last_task_message = params.message
            record.updated_at = new Date().toISOString()
          })
          return textResult('')
        }
        const queuedMessages = target.queued_messages
        spawnRuntime({
          ctx,
          registryDir,
          currentAgentPath: currentAgentPath(),
          canonicalTaskName: target.agent_name,
          requestedTaskName: target.requested_task_name,
          message: params.message,
          queuedMessages,
          agentType: target.agent_type,
          model: target.model,
          reasoningEffort: target.reasoning_effort,
          forkTurns: 'none',
          sessionFile: target.session_file,
          reuseSessionDir: target.session_dir,
          runId: target.run_id,
        })
        return textResult('')
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error),
          {},
          true,
        )
      }
    },
  })

  pi.registerTool({
    name: 'wait_agent',
    label: 'Wait Agent',
    description:
      'Wait for a mailbox update from any live agent, including queued messages and final-status notifications. Does not return the content; returns either a summary of which agents have updates, or a timeout summary if no mailbox update arrives before the deadline.',
    parameters: waitAgentSchema,
    async execute(_id, params: WaitAgentArgs, signal, _onUpdate, ctx) {
      try {
        const timeoutMs = clampTimeout(params.timeout_ms)
        const registryDir = resolveRegistryDir(ctx)
        const deadline = Date.now() + timeoutMs
        while (Date.now() <= deadline) {
          if (signal?.aborted)
            return textResult('Wait interrupted.', {
              message: 'Wait interrupted.',
              timed_out: false,
            })
          reconcileRegistry(registryDir)
          const updates = consumeMailboxUpdates(registryDir)
          if (updates.length > 0) {
            const names = updates
              .map(
                (agent) =>
                  `${agent.agent_name} (${statusSummary(agent.status)})`,
              )
              .join(', ')
            return outputResult({
              message: `Wait completed. Agents with updates: ${names}.`,
              timed_out: false,
            })
          }
          await sleep(
            Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())),
          )
        }
        return outputResult({ message: 'Wait timed out.', timed_out: true })
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error),
          {},
          true,
        )
      }
    },
  })

  pi.registerTool({
    name: 'close_agent',
    label: 'Close Agent',
    description:
      "Close an agent and any open descendants when they are no longer needed, and return the target agent's previous status before shutdown was requested. Don't keep agents open for too long if they are not needed anymore.",
    parameters: closeAgentSchema,
    async execute(_id, params: CloseAgentArgs, _signal, _onUpdate, ctx) {
      try {
        const registryDir = resolveRegistryDir(ctx)
        const registry = reconcileRegistry(registryDir)
        const target = resolveTarget(
          registry,
          currentAgentPath(),
          params.target,
        )
        if (!target) return outputResult({ previous_status: 'not_found' })
        const previousStatus = target.status
        updateRegistry(registryDir, (current) => {
          for (const record of current.agents) {
            if (
              record.agent_name !== target.agent_name &&
              !record.agent_name.startsWith(`${target.agent_name}/`)
            )
              continue
            record.closing = true
            const pid = record.pid
            if (
              record.status === 'running' &&
              typeof pid === 'number' &&
              processAlive(pid)
            ) {
              try {
                process.kill(pid, 'SIGTERM')
              } catch {
                // Best effort close.
              }
            }
            if (!isTerminalStatus(record.status)) record.status = 'shutdown'
            record.updated_at = new Date().toISOString()
            record.mailbox_update = true
          }
        })
        return outputResult({ previous_status: previousStatus })
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error),
          {},
          true,
        )
      }
    },
  })

  pi.registerTool({
    name: 'list_agents',
    label: 'List Agents',
    description:
      'List live agents in the current root thread tree. Optionally filter by task-path prefix.',
    parameters: listAgentsSchema,
    async execute(_id, params: ListAgentsArgs, _signal, _onUpdate, ctx) {
      try {
        const registryDir = resolveRegistryDir(ctx)
        return outputResult({
          agents: listAgentPayload(registryDir, params.path_prefix),
        })
      } catch (error) {
        return textResult(
          error instanceof Error ? error.message : String(error),
          {},
          true,
        )
      }
    },
  })
}
