import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateTail,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'

const DEFAULT_EXEC_YIELD_TIME_MS = 10_000
const DEFAULT_WRITE_STDIN_YIELD_TIME_MS = 250
const DEFAULT_SHELL_TIMEOUT_MS = 60_000
const CODEX_TOOLS_STATUS_KEY = 'codex-tools'

const permissionProfileSchema = Type.Optional(
  Type.Object(
    {
      network: Type.Optional(
        Type.Object(
          {
            enabled: Type.Optional(
              Type.Boolean({
                description: 'Set to true to request network access.',
              }),
            ),
          },
          { additionalProperties: false },
        ),
      ),
      file_system: Type.Optional(
        Type.Object(
          {
            read: Type.Optional(
              Type.Array(Type.String(), {
                description: 'Absolute paths to grant read access to.',
              }),
            ),
            write: Type.Optional(
              Type.Array(Type.String(), {
                description: 'Absolute paths to grant write access to.',
              }),
            ),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
)

const approvalParameters = {
  sandbox_permissions: Type.Optional(
    Type.String({
      description:
        'Sandbox permissions for the command. Set to "require_escalated" to request running without sandbox restrictions; defaults to "use_default".',
    }),
  ),
  additional_permissions: permissionProfileSchema,
  justification: Type.Optional(
    Type.String({
      description:
        'Only set if sandbox_permissions is "require_escalated". Request approval from the user to run this command outside the sandbox.',
    }),
  ),
  prefix_rule: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'Only specify when sandbox_permissions is `require_escalated`. Suggest a prefix command pattern that will allow similar future requests.',
    }),
  ),
}

const shellSchema = Type.Object(
  {
    command: Type.Array(Type.String(), {
      description: 'The command to execute',
    }),
    workdir: Type.Optional(
      Type.String({
        description: 'The working directory to execute the command in',
      }),
    ),
    timeout_ms: Type.Optional(
      Type.Number({
        description: 'The timeout for the command in milliseconds',
      }),
    ),
    ...approvalParameters,
  },
  { additionalProperties: false },
)

const shellCommandSchema = Type.Object(
  {
    command: Type.String({
      description: "The shell script to execute in the user's default shell",
    }),
    workdir: Type.Optional(
      Type.String({
        description: 'The working directory to execute the command in',
      }),
    ),
    timeout_ms: Type.Optional(
      Type.Number({
        description: 'The timeout for the command in milliseconds',
      }),
    ),
    login: Type.Optional(
      Type.Boolean({
        description:
          'Whether to run the shell with login shell semantics. Defaults to true.',
      }),
    ),
    ...approvalParameters,
  },
  { additionalProperties: false },
)

const execCommandSchema = Type.Object(
  {
    cmd: Type.String({ description: 'Shell command to execute.' }),
    workdir: Type.Optional(
      Type.String({
        description:
          'Optional working directory to run the command in; defaults to the turn cwd.',
      }),
    ),
    shell: Type.Optional(
      Type.String({
        description:
          "Shell binary to launch. Defaults to the user's default shell.",
      }),
    ),
    login: Type.Optional(
      Type.Boolean({
        description:
          'Whether to run the shell with -l/-i semantics. Defaults to true.',
      }),
    ),
    tty: Type.Optional(
      Type.Boolean({
        description:
          'Whether to allocate a TTY for the command. Defaults to false (plain pipes); accepted for Codex compatibility.',
      }),
    ),
    yield_time_ms: Type.Optional(
      Type.Number({
        description:
          'How long to wait (in milliseconds) for output before yielding.',
      }),
    ),
    max_output_tokens: Type.Optional(
      Type.Number({
        description:
          'Maximum number of tokens to return. Excess output will be truncated.',
      }),
    ),
    environment_id: Type.Optional(
      Type.String({
        description:
          'Optional environment id from the <environment_context> block. Accepted for Codex compatibility; Pi uses the local environment.',
      }),
    ),
    ...approvalParameters,
  },
  { additionalProperties: false },
)

const writeStdinSchema = Type.Object(
  {
    session_id: Type.Number({
      description: 'Identifier of the running unified exec session.',
    }),
    chars: Type.Optional(
      Type.String({
        description: 'Bytes to write to stdin (may be empty to poll).',
      }),
    ),
    yield_time_ms: Type.Optional(
      Type.Number({
        description:
          'How long to wait (in milliseconds) for output before yielding.',
      }),
    ),
    max_output_tokens: Type.Optional(
      Type.Number({
        description:
          'Maximum number of tokens to return. Excess output will be truncated.',
      }),
    ),
  },
  { additionalProperties: false },
)

const applyPatchSchema = Type.Object(
  {
    input: Type.String({
      description: 'The entire contents of the apply_patch command',
    }),
  },
  { additionalProperties: false },
)

type ApplyPatchArgs = Static<typeof applyPatchSchema>

const viewImageSchema = Type.Object(
  {
    path: Type.String({
      description: 'Local filesystem path to an image file',
    }),
    detail: Type.Optional(
      Type.String({
        description:
          'Optional detail override. The only supported value is `original`; omit this field for default resized behavior.',
      }),
    ),
  },
  { additionalProperties: false },
)

interface CommandResultDetails {
  exit_code: number | null
  timed_out?: boolean
  truncation?: unknown
  fullOutputPath?: string
}

interface UnifiedExecDetails {
  exit_code?: number
  timed_out?: boolean
  truncation?: unknown
  fullOutputPath?: string
  chunk_id?: string
  wall_time_seconds: number
  session_id?: number
  original_token_count?: number
  output: string
}

interface RunningSession {
  id: number
  child: ChildProcessWithoutNullStreams
  output: string
  readOffset: number
  startedAt: number
  exitCode: number | null | undefined
  killed: boolean
  done: Promise<void>
}

interface SpawnResult {
  output: string
  exitCode: number | null | undefined
  timedOut: boolean
}

interface PatchChangeBase {
  oldPath?: string
  newPath?: string
}

interface AddFileChange extends PatchChangeBase {
  type: 'add'
  newPath: string
  content: string
}

interface DeleteFileChange extends PatchChangeBase {
  type: 'delete'
  oldPath: string
}

interface UpdateHunk {
  oldLines: string[]
  newLines: string[]
}

interface UpdateFileChange extends PatchChangeBase {
  type: 'update'
  oldPath: string
  newPath?: string
  hunks: UpdateHunk[]
}

type PatchChange = AddFileChange | DeleteFileChange | UpdateFileChange

let nextSessionId = 1
const runningSessions = new Map<number, RunningSession>()

function stripAtPrefix(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value
}

function resolveWorkdir(
  ctx: ExtensionContext,
  workdir: string | undefined,
): string {
  if (!workdir?.trim()) return ctx.cwd
  const normalized = stripAtPrefix(workdir.trim())
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(ctx.cwd, normalized)
}

function resolveTargetPath(ctx: ExtensionContext, targetPath: string): string {
  const normalized = stripAtPrefix(targetPath.trim())
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(ctx.cwd, normalized)
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'cmd.exe'
  }
  return process.env.SHELL ?? '/bin/sh'
}

function shellArgs(
  shellPath: string,
  command: string,
  login: boolean,
): string[] {
  if (process.platform === 'win32') {
    const basename = path.basename(shellPath).toLowerCase()
    if (basename.includes('powershell') || basename === 'pwsh.exe') {
      return ['-NoProfile', '-Command', command]
    }
    return ['/d', '/s', '/c', command]
  }

  const basename = path.basename(shellPath)
  if (login && (basename.includes('bash') || basename.includes('zsh'))) {
    return ['-lc', command]
  }
  return ['-c', command]
}

function maxBytesForTokens(maxOutputTokens: number | undefined): number {
  if (!maxOutputTokens || !Number.isFinite(maxOutputTokens))
    return DEFAULT_MAX_BYTES
  return Math.max(
    1024,
    Math.min(DEFAULT_MAX_BYTES, Math.floor(maxOutputTokens * 4)),
  )
}

async function persistFullOutput(output: string): Promise<string> {
  const filePath = path.join(tmpdir(), `pi-codex-tools-${randomUUID()}.log`)
  await writeFile(filePath, output, 'utf8')
  return filePath
}

async function formatOutput(
  output: string,
  maxOutputTokens?: number,
): Promise<{
  text: string
  truncation?: unknown
  fullOutputPath?: string
  originalTokenCount?: number
}> {
  const truncation = truncateTail(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: maxBytesForTokens(maxOutputTokens),
  })
  if (!truncation.truncated) {
    return { text: truncation.content }
  }

  const fullOutputPath = await persistFullOutput(output)
  const startLine = truncation.totalLines - truncation.outputLines + 1
  const endLine = truncation.totalLines
  const notice = `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output: ${fullOutputPath}]`

  return {
    text: `${truncation.content}${notice}`,
    truncation,
    fullOutputPath,
    originalTokenCount: Math.ceil(output.length / 4),
  }
}

function wait(
  ms: number,
  signal?: AbortSignal,
): Promise<'elapsed' | 'aborted'> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve('aborted')
      return
    }

    const timeout = setTimeout(
      () => {
        cleanup()
        resolve('elapsed')
      },
      Math.max(0, ms),
    )

    const onAbort = () => {
      clearTimeout(timeout)
      cleanup()
      resolve('aborted')
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function runCommandToCompletion(
  command: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SpawnResult> {
  if (command.length === 0 || !command[0]) {
    throw new Error('command must contain at least one argument')
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command[0] as string, command.slice(1), {
      cwd,
      env: process.env,
      windowsHide: true,
    })
    let output = ''
    let settled = false
    let timedOut = false

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ output, exitCode, timedOut })
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    const onAbort = () => {
      child.kill('SIGTERM')
      fail(new Error('Command aborted'))
    }

    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
    })
    child.on('error', fail)
    child.on('close', finish)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function spawnManagedSession(command: string[], cwd: string): RunningSession {
  if (command.length === 0 || !command[0]) {
    throw new Error('cmd must resolve to at least one command argument')
  }

  const id = nextSessionId++
  const child = spawn(command[0] as string, command.slice(1), {
    cwd,
    env: process.env,
    windowsHide: true,
  })
  const session: RunningSession = {
    id,
    child,
    output: '',
    readOffset: 0,
    startedAt: Date.now(),
    exitCode: undefined,
    killed: false,
    done: Promise.resolve(),
  }

  session.done = new Promise((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      session.output += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      session.output += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      session.output += `\n${error.message}\n`
      session.exitCode = 1
    })
    child.on('close', (exitCode) => {
      session.exitCode = exitCode
      resolve()
    })
  })

  runningSessions.set(id, session)
  return session
}

async function waitForSessionOutput(
  session: RunningSession,
  yieldTimeMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (session.exitCode !== undefined) return

  await Promise.race([
    session.done,
    wait(yieldTimeMs, signal).then((result) => {
      if (result === 'aborted') {
        session.killed = true
        session.child.kill('SIGTERM')
      }
    }),
  ])
}

async function buildUnifiedExecResult(
  session: RunningSession,
  startedAt: number,
  maxOutputTokens: number | undefined,
): Promise<{
  content: { type: 'text'; text: string }[]
  details: UnifiedExecDetails
}> {
  const unreadOutput = session.output.slice(session.readOffset)
  session.readOffset = session.output.length
  const formatted = await formatOutput(unreadOutput, maxOutputTokens)
  const wallTimeSeconds = (Date.now() - startedAt) / 1000
  const stillRunning = session.exitCode === undefined

  if (!stillRunning) {
    runningSessions.delete(session.id)
  }

  const sections = [`Wall time: ${wallTimeSeconds.toFixed(4)} seconds`]
  if (session.exitCode !== undefined) {
    sections.push(`Process exited with code ${session.exitCode ?? 0}`)
  }
  if (stillRunning) {
    sections.push(`Process running with session ID ${session.id}`)
  }
  if (formatted.originalTokenCount !== undefined) {
    sections.push(`Original token count: ${formatted.originalTokenCount}`)
  }
  sections.push('Output:')
  sections.push(formatted.text)

  const output = sections.join('\n')
  return {
    content: [{ type: 'text', text: output }],
    details: {
      wall_time_seconds: wallTimeSeconds,
      exit_code:
        session.exitCode === undefined ? undefined : (session.exitCode ?? 0),
      session_id: stillRunning ? session.id : undefined,
      original_token_count: formatted.originalTokenCount,
      output: formatted.text,
      truncation: formatted.truncation,
      fullOutputPath: formatted.fullOutputPath,
    },
  }
}

async function runShellStyleTool(
  command: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const result = await runCommandToCompletion(command, cwd, timeoutMs, signal)
  const formatted = await formatOutput(result.output || '(no output)')
  const status = result.timedOut
    ? `\n\nCommand timed out after ${timeoutMs} milliseconds`
    : result.exitCode && result.exitCode !== 0
      ? `\n\nCommand exited with code ${result.exitCode}`
      : ''

  return {
    content: [{ type: 'text' as const, text: `${formatted.text}${status}` }],
    details: {
      exit_code: result.exitCode ?? null,
      timed_out: result.timedOut || undefined,
      truncation: formatted.truncation,
      fullOutputPath: formatted.fullOutputPath,
    } satisfies CommandResultDetails,
  }
}

function parsePatch(input: string): PatchChange[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '*** Begin Patch') {
    throw new Error('patch must start with *** Begin Patch')
  }

  const changes: PatchChange[] = []
  let index = 1

  const requireRelativePath = (filePath: string): string => {
    const trimmed = filePath.trim()
    if (!trimmed || path.isAbsolute(trimmed) || trimmed.includes('\0')) {
      throw new Error(`invalid relative path: ${filePath}`)
    }
    return stripAtPrefix(trimmed)
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line === '*** End Patch') return changes

    if (line.startsWith('*** Add File: ')) {
      const newPath = requireRelativePath(line.slice('*** Add File: '.length))
      index += 1
      const contentLines: string[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        if (current.startsWith('*** ')) break
        if (!current.startsWith('+')) {
          throw new Error(`add file lines must start with + near ${newPath}`)
        }
        contentLines.push(current.slice(1))
        index += 1
      }
      changes.push({ type: 'add', newPath, content: contentLines.join('\n') })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      changes.push({
        type: 'delete',
        oldPath: requireRelativePath(line.slice('*** Delete File: '.length)),
      })
      index += 1
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const oldPath = requireRelativePath(
        line.slice('*** Update File: '.length),
      )
      index += 1
      let newPath: string | undefined
      if ((lines[index] ?? '').startsWith('*** Move to: ')) {
        newPath = requireRelativePath(
          (lines[index] ?? '').slice('*** Move to: '.length),
        )
        index += 1
      }

      const hunks: UpdateHunk[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        if (current.startsWith('*** ')) break
        if (!current.startsWith('@@')) {
          throw new Error(`expected hunk header near ${oldPath}`)
        }
        index += 1
        const oldLines: string[] = []
        const newLines: string[] = []
        while (index < lines.length) {
          const hunkLine = lines[index] ?? ''
          if (hunkLine.startsWith('@@') || hunkLine.startsWith('*** ')) break
          if (hunkLine === '*** End of File') {
            index += 1
            continue
          }
          const prefix = hunkLine[0]
          const text = hunkLine.slice(1)
          if (prefix === ' ') {
            oldLines.push(text)
            newLines.push(text)
          } else if (prefix === '-') {
            oldLines.push(text)
          } else if (prefix === '+') {
            newLines.push(text)
          } else if (hunkLine === '') {
            oldLines.push('')
            newLines.push('')
          } else {
            throw new Error(`invalid hunk line near ${oldPath}: ${hunkLine}`)
          }
          index += 1
        }
        hunks.push({ oldLines, newLines })
      }
      changes.push({ type: 'update', oldPath, newPath, hunks })
      continue
    }

    if (line.trim() === '') {
      index += 1
      continue
    }

    throw new Error(`unexpected patch line: ${line}`)
  }

  throw new Error('patch must end with *** End Patch')
}

function splitFileLines(contents: string): {
  lines: string[]
  trailingNewline: boolean
} {
  const trailingNewline = contents.endsWith('\n')
  const lines = contents.replace(/\n$/, '').split('\n')
  if (lines.length === 1 && lines[0] === '' && !trailingNewline)
    return { lines: [], trailingNewline }
  return { lines, trailingNewline }
}

function findSubsequence(
  haystack: string[],
  needle: string[],
  fromIndex: number,
): number {
  if (needle.length === 0) return fromIndex
  for (
    let index = fromIndex;
    index <= haystack.length - needle.length;
    index += 1
  ) {
    let matches = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false
        break
      }
    }
    if (matches) return index
  }
  return -1
}

async function applyUpdate(
  change: UpdateFileChange,
  ctx: ExtensionContext,
): Promise<void> {
  const oldAbsolutePath = resolveTargetPath(ctx, change.oldPath)
  const contents = await readFile(oldAbsolutePath, 'utf8')
  const parsed = splitFileLines(contents)
  let fileLines = parsed.lines
  let searchIndex = 0

  for (const hunk of change.hunks) {
    const matchIndex = findSubsequence(fileLines, hunk.oldLines, searchIndex)
    if (matchIndex === -1) {
      throw new Error(`failed to find hunk context in ${change.oldPath}`)
    }
    fileLines = [
      ...fileLines.slice(0, matchIndex),
      ...hunk.newLines,
      ...fileLines.slice(matchIndex + hunk.oldLines.length),
    ]
    searchIndex = matchIndex + hunk.newLines.length
  }

  const updated = `${fileLines.join('\n')}${parsed.trailingNewline ? '\n' : ''}`
  await writeFile(oldAbsolutePath, updated, 'utf8')

  if (change.newPath && change.newPath !== change.oldPath) {
    const newAbsolutePath = resolveTargetPath(ctx, change.newPath)
    await mkdir(path.dirname(newAbsolutePath), { recursive: true })
    await rename(oldAbsolutePath, newAbsolutePath)
  }
}

function pathsForPatchChange(
  ctx: ExtensionContext,
  change: PatchChange,
): string[] {
  const paths: string[] = []
  if (change.oldPath) paths.push(resolveTargetPath(ctx, change.oldPath))
  if (change.newPath) paths.push(resolveTargetPath(ctx, change.newPath))
  return paths
}

async function withPatchMutationQueues<T>(
  filePaths: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const uniquePaths = [...new Set(filePaths)].sort()
  const wrap = (index: number): Promise<T> => {
    if (index >= uniquePaths.length) return operation()
    return withFileMutationQueue(uniquePaths[index] as string, () =>
      wrap(index + 1),
    )
  }
  return wrap(0)
}

async function applyPatch(
  input: string,
  ctx: ExtensionContext,
): Promise<string> {
  const changes = parsePatch(input)
  const filePaths = changes.flatMap((change) =>
    pathsForPatchChange(ctx, change),
  )

  return withPatchMutationQueues(filePaths, async () => {
    for (const change of changes) {
      if (change.type === 'add') {
        const targetPath = resolveTargetPath(ctx, change.newPath)
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, change.content, {
          encoding: 'utf8',
          flag: 'wx',
        })
      } else if (change.type === 'delete') {
        await unlink(resolveTargetPath(ctx, change.oldPath))
      } else {
        await applyUpdate(change, ctx)
      }
    }
  }).then(() => {
    const summary = changes
      .map((change) => {
        if (change.type === 'add') return `added ${change.newPath}`
        if (change.type === 'delete') return `deleted ${change.oldPath}`
        if (change.newPath && change.newPath !== change.oldPath) {
          return `updated ${change.oldPath} and moved to ${change.newPath}`
        }
        return `updated ${change.oldPath}`
      })
      .join('\n')
    return `Success. Applied patch:\n${summary}`
  })
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  if (extension === '.svg') return 'image/svg+xml'
  return 'image/png'
}

function prepareApplyPatchArguments(args: unknown): ApplyPatchArgs {
  if (typeof args === 'string') return { input: args }
  if (args && typeof args === 'object' && 'input' in args) {
    return args as ApplyPatchArgs
  }
  return { input: String(args ?? '') }
}

export default function codexTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'shell',
    label: 'Shell',
    description:
      'Runs a shell command and returns its output. The arguments to `shell` will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"]. Always set the `workdir` param when using the shell function. Do not use `cd` unless absolutely necessary.',
    promptSnippet:
      'Run argv-style shell commands with Codex-compatible `command`, `workdir`, and `timeout_ms` arguments.',
    parameters: shellSchema,
    executionMode: 'parallel',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return runShellStyleTool(
        params.command,
        resolveWorkdir(ctx, params.workdir),
        params.timeout_ms ?? DEFAULT_SHELL_TIMEOUT_MS,
        signal,
      )
    },
  })

  pi.registerTool({
    name: 'local_shell',
    label: 'Local Shell',
    description:
      'Runs a local shell command and returns its output. This is a Pi-compatible function-tool representation of Codex/OpenAI local_shell.',
    promptSnippet:
      'Run local argv-style shell commands using the Codex `local_shell` tool name.',
    parameters: shellSchema,
    executionMode: 'parallel',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return runShellStyleTool(
        params.command,
        resolveWorkdir(ctx, params.workdir),
        params.timeout_ms ?? DEFAULT_SHELL_TIMEOUT_MS,
        signal,
      )
    },
  })

  pi.registerTool({
    name: 'shell_command',
    label: 'Shell Command',
    description:
      'Runs a shell command and returns its output. Always set the `workdir` param when using the shell_command function. Do not use `cd` unless absolutely necessary.',
    promptSnippet:
      'Run a shell script string in the user default shell with Codex-compatible arguments.',
    parameters: shellCommandSchema,
    executionMode: 'parallel',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const shellPath = defaultShell()
      const command = [
        shellPath,
        ...shellArgs(shellPath, params.command, params.login ?? true),
      ]
      return runShellStyleTool(
        command,
        resolveWorkdir(ctx, params.workdir),
        params.timeout_ms ?? DEFAULT_SHELL_TIMEOUT_MS,
        signal,
      )
    },
  })

  pi.registerTool({
    name: 'exec_command',
    label: 'Exec Command',
    description:
      'Runs a command in a PTY, returning output or a session ID for ongoing interaction.',
    promptSnippet:
      'Run a shell command and receive Codex-style output or a `session_id` for follow-up `write_stdin` calls.',
    parameters: execCommandSchema,
    executionMode: 'parallel',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = resolveWorkdir(ctx, params.workdir)
      const shellPath = params.shell ?? defaultShell()
      const command = [
        shellPath,
        ...shellArgs(shellPath, params.cmd, params.login ?? true),
      ]
      const startedAt = Date.now()
      const session = spawnManagedSession(command, cwd)

      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            session.killed = true
            session.child.kill('SIGTERM')
          },
          { once: true },
        )
      }

      await waitForSessionOutput(
        session,
        params.yield_time_ms ?? DEFAULT_EXEC_YIELD_TIME_MS,
        signal,
      )
      return buildUnifiedExecResult(
        session,
        startedAt,
        params.max_output_tokens,
      )
    },
  })

  pi.registerTool({
    name: 'write_stdin',
    label: 'Write Stdin',
    description:
      'Writes characters to an existing unified exec session and returns recent output.',
    promptSnippet:
      'Write characters to an `exec_command` session and return recent output.',
    parameters: writeStdinSchema,
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal) {
      const session = runningSessions.get(params.session_id)
      if (!session) {
        throw new Error(
          `write_stdin failed: unknown session_id ${params.session_id}`,
        )
      }

      const startedAt = Date.now()
      const chars = params.chars ?? ''
      if (chars) {
        session.child.stdin.write(chars)
      }
      await waitForSessionOutput(
        session,
        params.yield_time_ms ?? DEFAULT_WRITE_STDIN_YIELD_TIME_MS,
        signal,
      )
      return buildUnifiedExecResult(
        session,
        startedAt,
        params.max_output_tokens,
      )
    },
  })

  pi.registerTool({
    name: 'apply_patch',
    label: 'Apply Patch',
    description: `Use the \`apply_patch\` tool to edit files.
Your patch language is a stripped-down, file-oriented diff format.

*** Begin Patch
[ one or more file sections ]
*** End Patch

Each operation starts with one of three headers:
*** Add File: <path>
*** Delete File: <path>
*** Update File: <path>

File references can only be relative, never absolute.`,
    promptSnippet:
      'Apply Codex-style file patches using an `input` string containing the full patch.',
    parameters: applyPatchSchema,
    prepareArguments: prepareApplyPatchArguments,
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const text = await applyPatch(params.input, ctx)
      return {
        content: [{ type: 'text', text }],
        details: { applied: true },
      }
    },
  })

  pi.registerTool({
    name: 'view_image',
    label: 'View Image',
    description:
      "View a local image from the filesystem (only use if given a full filepath by the user, and the image isn't already attached to the thread context within <image ...> tags).",
    promptSnippet:
      'Attach a local image file to the model context using the Codex `view_image` tool shape.',
    parameters: viewImageSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.detail !== undefined && params.detail !== 'original') {
        throw new Error(
          `view_image.detail only supports \`original\`; omit \`detail\` for default resized behavior, got \`${params.detail}\``,
        )
      }

      const imagePath = resolveTargetPath(ctx, params.path)
      const data = await readFile(imagePath)
      const mimeType = mimeTypeForPath(imagePath)
      const base64 = data.toString('base64')
      const imageUrl = `data:${mimeType};base64,${base64}`

      return {
        content: [{ type: 'image', data: base64, mimeType }],
        details: {
          image_url: imageUrl,
          detail: params.detail ?? null,
          path: imagePath,
        },
      }
    },
  })

  pi.on('session_start', async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setStatus(CODEX_TOOLS_STATUS_KEY, 'codex tools')
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    for (const session of runningSessions.values()) {
      session.killed = true
      session.child.kill('SIGTERM')
    }
    runningSessions.clear()
    if (ctx.hasUI) ctx.ui.setStatus(CODEX_TOOLS_STATUS_KEY, undefined)
  })
}
