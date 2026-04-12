import * as childProcess from 'node:child_process'
import { basename } from 'path'

export class WorktrunkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorktrunkError'
  }
}

export interface WorktrunkCommitInfo {
  shortSha?: string
  message?: string
}

export interface WorktrunkBranchRelation {
  ahead?: number
  behind?: number
}

export interface WorktrunkWorkingTreeState {
  staged?: boolean
  modified?: boolean
  untracked?: boolean
  renamed?: boolean
  deleted?: boolean
}

export interface WorktrunkListEntry {
  branch: string | null
  path?: string
  kind: string
  isCurrent: boolean
  isMain: boolean
  isPrevious?: boolean
  statusline?: string
  symbols?: string
  mainState?: string
  operationState?: string
  url?: string
  urlActive?: boolean
  commit?: WorktrunkCommitInfo
  main?: WorktrunkBranchRelation
  remote?: WorktrunkBranchRelation
  workingTree?: WorktrunkWorkingTreeState
}

export interface WorktrunkCommandResult {
  stdout: string
  stderr: string
}

export interface WorktrunkCreateResult {
  branch: string
  path: string
}

export interface WorktrunkService {
  ensureAvailable(_cwd: string): void
  run(_args: string[], _cwd: string): WorktrunkCommandResult
  list(_cwd: string): Promise<WorktrunkListEntry[]>
  resolveRef(
    _worktrees: WorktrunkListEntry[],
    _ref: string,
  ): WorktrunkListEntry | undefined
  getCurrent(_cwd: string): Promise<WorktrunkListEntry | undefined>
  create(_cwd: string, _branch: string): Promise<WorktrunkCreateResult>
  switchTo(_cwd: string, _branch: string): Promise<WorktrunkCreateResult>
  remove(_cwd: string, _ref: string): Promise<void>
  showConfig(_cwd: string): Promise<string>
}

type JsonRecord = Record<string, unknown>

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function formatMissingBinaryMessage(): string {
  return [
    'Worktrunk (wt) is not installed or not on PATH.',
    'Install it first, then configure shell integration with `wt config shell install`.',
    'Docs: https://worktrunk.dev/worktrunk/',
  ].join(' ')
}

function formatCommandFailure(
  args: string[],
  stdout: string,
  stderr: string,
  status: number | null,
): string {
  const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
  if (!details) {
    return `wt ${args.join(' ')} failed with exit code ${status ?? 'unknown'}`
  }

  return `wt ${args.join(' ')} failed: ${details}`
}

function mapListEntry(item: JsonRecord): WorktrunkListEntry {
  const commitValue = item.commit
  const mainValue = item.main
  const remoteValue = item.remote
  const workingTreeValue = item.working_tree

  const commit =
    commitValue && typeof commitValue === 'object'
      ? {
          shortSha: toOptionalString((commitValue as JsonRecord).short_sha),
          message: toOptionalString((commitValue as JsonRecord).message),
        }
      : undefined

  const main =
    mainValue && typeof mainValue === 'object'
      ? {
          ahead: toOptionalNumber((mainValue as JsonRecord).ahead),
          behind: toOptionalNumber((mainValue as JsonRecord).behind),
        }
      : undefined

  const remote =
    remoteValue && typeof remoteValue === 'object'
      ? {
          ahead: toOptionalNumber((remoteValue as JsonRecord).ahead),
          behind: toOptionalNumber((remoteValue as JsonRecord).behind),
        }
      : undefined

  const workingTree =
    workingTreeValue && typeof workingTreeValue === 'object'
      ? {
          staged: toOptionalBoolean((workingTreeValue as JsonRecord).staged),
          modified: toOptionalBoolean(
            (workingTreeValue as JsonRecord).modified,
          ),
          untracked: toOptionalBoolean(
            (workingTreeValue as JsonRecord).untracked,
          ),
          renamed: toOptionalBoolean((workingTreeValue as JsonRecord).renamed),
          deleted: toOptionalBoolean((workingTreeValue as JsonRecord).deleted),
        }
      : undefined

  return {
    branch: typeof item.branch === 'string' ? item.branch : null,
    path: toOptionalString(item.path),
    kind: toOptionalString(item.kind) ?? 'worktree',
    isCurrent: item.is_current === true,
    isMain: item.is_main === true,
    isPrevious: toOptionalBoolean(item.is_previous),
    statusline: toOptionalString(item.statusline),
    symbols: toOptionalString(item.symbols),
    mainState: toOptionalString(item.main_state),
    operationState: toOptionalString(item.operation_state),
    url: toOptionalString(item.url),
    urlActive: toOptionalBoolean(item.url_active),
    commit,
    main,
    remote,
    workingTree,
  }
}

function runWt(args: string[], cwd: string): WorktrunkCommandResult {
  const result = childProcess.spawnSync('wt', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) {
    const spawnError = result.error as Error & { code?: string; path?: string }
    if (spawnError.code === 'ENOENT' && spawnError.path === 'wt') {
      throw new WorktrunkError(formatMissingBinaryMessage())
    }

    if (spawnError.code === 'ENOENT') {
      throw new WorktrunkError(
        `Worktrunk command failed because the working directory does not exist: ${cwd}`,
      )
    }

    throw new WorktrunkError(result.error.message)
  }

  if (result.status === 127) {
    throw new WorktrunkError(formatMissingBinaryMessage())
  }

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''

  if (result.status !== 0) {
    throw new WorktrunkError(
      formatCommandFailure(args, stdout, stderr, result.status),
    )
  }

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  }
}

function requirePath(entry: WorktrunkListEntry, branch: string): string {
  if (!entry.path) {
    throw new WorktrunkError(
      `Worktrunk created/switched '${branch}', but no worktree path was present in 'wt list --format=json'.`,
    )
  }

  return entry.path
}

async function runSwitchAndResolve(
  cwd: string,
  args: string[],
  branch: string,
): Promise<WorktrunkCreateResult> {
  runWt(args, cwd)
  const worktrees = await listWorktrees(cwd)
  const target = resolveWorktreeRef(worktrees, branch)

  if (!target) {
    throw new WorktrunkError(
      `Worktrunk completed, but the branch '${branch}' was not found in 'wt list --format=json'.`,
    )
  }

  return {
    branch,
    path: requirePath(target, branch),
  }
}

export function ensureWorktrunkAvailable(cwd: string): void {
  runWt(['--help'], cwd)
}

export async function listWorktrees(
  cwd: string,
): Promise<WorktrunkListEntry[]> {
  const result = runWt(['list', '--format=json'], cwd)

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout || '[]')
  } catch (error) {
    throw new WorktrunkError(
      `Failed to parse 'wt list --format=json' output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new WorktrunkError(
      "Unexpected 'wt list --format=json' output: expected a JSON array.",
    )
  }

  return parsed.map((item) => mapListEntry((item as JsonRecord) ?? {}))
}

export function resolveWorktreeRef(
  worktrees: WorktrunkListEntry[],
  ref: string,
): WorktrunkListEntry | undefined {
  return worktrees.find((worktree) => {
    const path = worktree.path ?? ''
    return worktree.branch === ref || path === ref || basename(path) === ref
  })
}

export async function getCurrentWorktree(
  cwd: string,
): Promise<WorktrunkListEntry | undefined> {
  const worktrees = await listWorktrees(cwd)
  return worktrees.find((worktree) => worktree.isCurrent)
}

export async function createWorktree(
  cwd: string,
  branch: string,
): Promise<WorktrunkCreateResult> {
  return runSwitchAndResolve(
    cwd,
    ['switch', '--create', '--no-cd', branch],
    branch,
  )
}

export async function switchToWorktree(
  cwd: string,
  branch: string,
): Promise<WorktrunkCreateResult> {
  return runSwitchAndResolve(cwd, ['switch', '--no-cd', branch], branch)
}

export async function removeWorktree(cwd: string, ref: string): Promise<void> {
  runWt(['remove', '--yes', ref], cwd)
}

export async function showWorktrunkConfig(cwd: string): Promise<string> {
  const result = runWt(['config', 'show'], cwd)
  return result.stdout
}

export function createWorktrunkService(): WorktrunkService {
  return {
    ensureAvailable: ensureWorktrunkAvailable,
    run: runWt,
    list: listWorktrees,
    resolveRef: resolveWorktreeRef,
    getCurrent: getCurrentWorktree,
    create: createWorktree,
    switchTo: switchToWorktree,
    remove: removeWorktree,
    showConfig: showWorktrunkConfig,
  }
}
