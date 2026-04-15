import * as os from 'node:os'
import * as path from 'node:path'

export const SUBAGENT_SESSION_DIR = path.join(
  os.homedir(),
  '.pi',
  'agent',
  'sessions',
  'subagents',
)

export const NAME_SYSTEM_PROMPT = [
  "Read the user's first request and generate a very short session title.",
  'Requirements:',
  '- Output English only, even if the request is written in another language.',
  '- Output only the title text.',
  '- No quotes, markdown, prefixes, or explanations.',
  '- Keep it concise: usually 2 to 6 words.',
  '- Maximum 30 characters.',
].join('\n')

export const MAX_MESSAGE_LENGTH = 500
export const MAX_NAME_LENGTH = 30
export const MAX_STATUS_CHARS = 90
export const SUCCESSFUL_STOP_REASON = 'stop'

export function isSubagentSessionPath(
  sessionFilePath: string | undefined,
): boolean {
  if (!sessionFilePath) return false
  return (
    sessionFilePath.startsWith(SUBAGENT_SESSION_DIR + path.sep) ||
    sessionFilePath.startsWith(`${SUBAGENT_SESSION_DIR}/`)
  )
}

export function extractSessionFilePath(
  sessionManager: unknown,
): string | undefined {
  try {
    if (
      sessionManager &&
      typeof sessionManager === 'object' &&
      'getSessionFile' in sessionManager
    ) {
      const getSessionFile = (sessionManager as Record<string, unknown>)
        .getSessionFile
      if (typeof getSessionFile === 'function') {
        const raw = String(getSessionFile() ?? '')
        const cleaned = raw.replace(/[\r\n\t]+/g, '').trim()
        return cleaned || undefined
      }
    }
  } catch {
    // Ignore errors and fall back to unnamed sessions.
  }

  return undefined
}

export function formatNameStatus(name: string): string {
  const singleLine = name.replace(/\s+/g, ' ').trim()
  return singleLine.length > MAX_STATUS_CHARS
    ? `${singleLine.slice(0, MAX_STATUS_CHARS - 1)}…`
    : singleLine
}

export function buildNameContext(userMessage: string): string {
  return `User message: ${userMessage.slice(0, MAX_MESSAGE_LENGTH)}`
}

export function isSuccessfulResult(stopReason: string | undefined): boolean {
  return stopReason === SUCCESSFUL_STOP_REASON
}

export function extractNameFromResult(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  const text = content
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')

  return text.slice(0, MAX_NAME_LENGTH)
}
