import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'

const DEFAULT_CONFIG_FILES = [
  '.pi/protected-files.jsonc',
  '.pi/protected-files.json',
  'pi-protected-files.jsonc',
  'pi-protected-files.json',
] as const

const WRITE_TOOL_NAMES = new Set(['write', 'edit'])
const MUTATING_BASH_PATTERNS = [
  /(^|[;&|()\s])>/,
  /(^|[;&|()\s])>>/,
  /\btee\b/,
  /\bsed\b[^\n;&|]*\s-i(?:\b|[.\s])/,
  /\bperl\b[^\n;&|]*\s-pi(?:\b|[.\s])/,
  /\bpython\d*\b[^\n;&|]*\b(open|write_text|touch|rename|unlink)\b/,
  /\bnode\b[^\n;&|]*\b(writeFile|appendFile|rmSync|renameSync)\b/,
  /\b(?:mv|cp|rm|truncate|touch|install)\b/,
]

export type ProtectionMode = 'block' | 'confirm'

export interface ProtectedFileEntry {
  path: string
  mode?: ProtectionMode
}

export interface ProtectedFilesConfig {
  mode: ProtectionMode
  files: ProtectedFileEntry[]
  configPath?: string
}

interface RawProtectedFilesConfig {
  mode?: unknown
  files?: unknown
  protectedFiles?: unknown
}

interface ProtectedFilesOptions {
  configFiles?: string[]
}

interface ProtectionMatch {
  entry: ProtectedFileEntry
  targetPath: string
}

type ToolCallDecision = { block: true; reason?: string } | undefined

type ToolCallEvent = {
  toolName: string
  input: Record<string, unknown>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProtectionMode(value: unknown): value is ProtectionMode {
  return value === 'block' || value === 'confirm'
}

function normalizeSlashes(value: string): string {
  return value.replaceAll('\\', '/')
}

function stripJsonComments(contents: string): string {
  let output = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    const next = contents[index + 1]

    if (inString) {
      output += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      output += character
      continue
    }

    if (character === '/' && next === '/') {
      while (index < contents.length && contents[index] !== '\n') {
        index += 1
      }
      output += '\n'
      continue
    }

    if (character === '/' && next === '*') {
      index += 2
      while (
        index < contents.length &&
        !(contents[index] === '*' && contents[index + 1] === '/')
      ) {
        output += contents[index] === '\n' ? '\n' : ' '
        index += 1
      }
      index += 1
      continue
    }

    output += character
  }

  return output
}

function normalizeRelativePath(cwd: string, targetPath: string): string {
  const absolutePath = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(cwd, targetPath)
  return normalizeSlashes(path.relative(cwd, absolutePath))
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegExp(pattern: string): RegExp {
  let source = ''

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    const next = pattern[index + 1]

    if (character === '*' && next === '*') {
      source += '.*'
      index += 1
      continue
    }

    if (character === '*') {
      source += '[^/]*'
      continue
    }

    if (character === '?') {
      source += '[^/]'
      continue
    }

    source += escapeRegExp(character ?? '')
  }

  return new RegExp(`^${source}$`)
}

function getEntryFilename(entryPath: string): string | undefined {
  const normalizedEntry = normalizeSlashes(entryPath.trim()).replace(
    /^\.\//,
    '',
  )
  if (!normalizedEntry) return undefined

  const filename = path.posix.basename(normalizedEntry.replace(/\/+$/, ''))
  if (!filename || filename === '**') return undefined

  return filename
}

function pathGlobMatches(pattern: string, relativePath: string): boolean {
  if (globToRegExp(pattern).test(relativePath)) return true
  if (pattern.includes('/')) {
    return globToRegExp(`**/${pattern}`).test(relativePath)
  }

  return false
}

function pathMatchesEntry(
  cwd: string,
  targetPath: string,
  entryPath: string,
): boolean {
  const normalizedEntry = normalizeSlashes(entryPath.trim()).replace(
    /^\.\//,
    '',
  )
  if (!normalizedEntry) return false

  const relativePath = normalizeRelativePath(cwd, targetPath)
  const isGlob = normalizedEntry.includes('*') || normalizedEntry.includes('?')

  if (isGlob && normalizedEntry.includes('/')) {
    return pathGlobMatches(normalizedEntry, relativePath)
  }

  const entryFilename = getEntryFilename(entryPath)
  if (!entryFilename) return false

  const targetFilename = path.posix.basename(relativePath)

  if (isGlob) {
    return globToRegExp(entryFilename).test(targetFilename)
  }

  return targetFilename === entryFilename
}

function parseProtectedFileEntry(
  value: unknown,
): ProtectedFileEntry | undefined {
  if (typeof value === 'string') {
    const entryPath = value.trim()
    return entryPath ? { path: entryPath } : undefined
  }

  if (!isObject(value) || typeof value.path !== 'string') return undefined

  const entryPath = value.path.trim()
  if (!entryPath) return undefined

  return {
    path: entryPath,
    mode: isProtectionMode(value.mode) ? value.mode : undefined,
  }
}

export function parseProtectedFilesConfig(
  contents: string,
  configPath?: string,
): ProtectedFilesConfig {
  const parsed = JSON.parse(
    stripJsonComments(contents),
  ) as RawProtectedFilesConfig
  const defaultMode = isProtectionMode(parsed.mode) ? parsed.mode : 'block'
  const rawFiles = Array.isArray(parsed.files)
    ? parsed.files
    : Array.isArray(parsed.protectedFiles)
      ? parsed.protectedFiles
      : []
  const files = rawFiles
    .map(parseProtectedFileEntry)
    .filter((entry): entry is ProtectedFileEntry => Boolean(entry))

  return {
    mode: defaultMode,
    files,
    configPath,
  }
}

async function loadProtectedFilesConfig(
  cwd: string,
  options: ProtectedFilesOptions,
): Promise<ProtectedFilesConfig | undefined> {
  const configFiles = options.configFiles ?? [...DEFAULT_CONFIG_FILES]

  for (const configFile of configFiles) {
    const configPath = path.isAbsolute(configFile)
      ? configFile
      : path.resolve(cwd, configFile)

    if (!existsSync(configPath)) continue

    const contents = await readFile(configPath, 'utf8')
    return parseProtectedFilesConfig(contents, configPath)
  }

  return undefined
}

function findProtectedPath(
  cwd: string,
  config: ProtectedFilesConfig,
  targetPath: string,
): ProtectionMatch | undefined {
  for (const entry of config.files) {
    if (pathMatchesEntry(cwd, targetPath, entry.path)) {
      return { entry, targetPath }
    }
  }

  return undefined
}

function getEventWriteTargets(event: ToolCallEvent): string[] {
  if (
    WRITE_TOOL_NAMES.has(event.toolName) &&
    typeof event.input.path === 'string'
  ) {
    return [event.input.path]
  }

  if (event.toolName !== 'multi_tool_use.parallel') return []
  if (!Array.isArray(event.input.tool_uses)) return []

  return event.input.tool_uses.flatMap((toolUse) => {
    if (!isObject(toolUse)) return []
    if (typeof toolUse.recipient_name !== 'string') return []
    if (!WRITE_TOOL_NAMES.has(toolUse.recipient_name.split('.').at(-1) ?? ''))
      return []
    if (!isObject(toolUse.parameters)) return []
    if (typeof toolUse.parameters.path !== 'string') return []
    return [toolUse.parameters.path]
  })
}

function shellTokenForPath(targetPath: string): RegExp {
  const escaped = escapeRegExp(normalizeSlashes(targetPath))
  return new RegExp(`(^|[^\\w./-])${escaped}($|[^\\w./-])`)
}

function commandMentionsProtectedPath(
  cwd: string,
  config: ProtectedFilesConfig,
  command: string,
): ProtectionMatch | undefined {
  const normalizedCommand = normalizeSlashes(command)

  for (const entry of config.files) {
    const entryFilename = getEntryFilename(entry.path)

    if (entryFilename) {
      const candidatePaths = [entryFilename, path.join(cwd, entryFilename)]

      for (const candidatePath of candidatePaths) {
        const normalizedCandidate = normalizeSlashes(candidatePath)
        if (shellTokenForPath(normalizedCandidate).test(normalizedCommand)) {
          return { entry, targetPath: entry.path }
        }
      }
    }

    for (const token of normalizedCommand.split(/\s+/)) {
      const cleanedToken = token.replace(/^["'`]+|["'`,;]+$/g, '')
      if (pathMatchesEntry(cwd, cleanedToken, entry.path)) {
        return { entry, targetPath: entry.path }
      }
    }
  }

  return undefined
}

function isMutatingBashCommand(command: string): boolean {
  return MUTATING_BASH_PATTERNS.some((pattern) => pattern.test(command))
}

function getCwd(ctx: ExtensionContext): string {
  return typeof ctx.cwd === 'string' ? ctx.cwd : process.cwd()
}

function formatMatch(match: ProtectionMatch): string {
  const modeSuffix = match.entry.mode ? ` (${match.entry.mode})` : ''
  return `${match.targetPath} matches ${match.entry.path}${modeSuffix}`
}

async function confirmProtectedEdit(
  ctx: ExtensionContext,
  match: ProtectionMatch,
): Promise<boolean> {
  if (!ctx.hasUI) return false

  return ctx.ui.confirm(
    'Protected file edit',
    `Allow Pi to edit ${match.targetPath}?\n\nMatched rule: ${match.entry.path}`,
  )
}

async function decideProtectedEdit(
  ctx: ExtensionContext,
  config: ProtectedFilesConfig,
  match: ProtectionMatch,
): Promise<ToolCallDecision> {
  const mode = match.entry.mode ?? config.mode

  if (mode === 'confirm') {
    const allowed = await confirmProtectedEdit(ctx, match)
    if (allowed) return undefined
    return {
      block: true,
      reason: `Protected edit denied: ${formatMatch(match)}`,
    }
  }

  if (ctx.hasUI) {
    ctx.ui.notify(`Blocked protected edit: ${formatMatch(match)}`, 'warning')
  }

  return { block: true, reason: `Protected file: ${formatMatch(match)}` }
}

async function handleToolCall(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  options: ProtectedFilesOptions,
): Promise<ToolCallDecision> {
  const cwd = getCwd(ctx)
  const config = await loadProtectedFilesConfig(cwd, options)
  if (!config || config.files.length === 0) return undefined

  for (const targetPath of getEventWriteTargets(event)) {
    const match = findProtectedPath(cwd, config, targetPath)
    if (!match) continue
    return decideProtectedEdit(ctx, config, match)
  }

  if (event.toolName === 'bash' && typeof event.input.command === 'string') {
    const command = event.input.command
    if (!isMutatingBashCommand(command)) return undefined

    const match = commandMentionsProtectedPath(cwd, config, command)
    if (!match) return undefined

    return decideProtectedEdit(ctx, config, match)
  }

  return undefined
}

function notifyProtectionsDisabled(ctx: ExtensionCommandContext): void {
  if (!ctx.hasUI) return
  ctx.ui.notify(
    'Protected file guards disabled for the rest of this session.',
    'warning',
  )
}

export function createProtectedFilesExtension(
  options: ProtectedFilesOptions = {},
) {
  return function protectedFilesExtension(pi: ExtensionAPI) {
    let protectionsDisabled = false

    pi.registerCommand('disable-protections', {
      description: 'Disable pi-protected-files guards for this session',
      handler: async (_args, ctx) => {
        protectionsDisabled = true
        notifyProtectionsDisabled(ctx)
      },
    })

    pi.on('tool_call', async (event, ctx) => {
      if (protectionsDisabled) return undefined
      return handleToolCall(event as ToolCallEvent, ctx, options)
    })
  }
}

export default createProtectedFilesExtension()
