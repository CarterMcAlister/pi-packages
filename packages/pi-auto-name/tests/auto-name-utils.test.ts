import { describe, expect, test } from 'bun:test'
import {
  buildNameContext,
  extractNameFromResult,
  extractSessionFilePath,
  formatNameStatus,
  isSubagentSessionPath,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_STATUS_CHARS,
  NAME_SYSTEM_PROMPT,
  SUBAGENT_SESSION_DIR,
} from '../src/auto-name-utils.ts'

describe('auto-name utils', () => {
  test('detects subagent session paths', () => {
    expect(
      isSubagentSessionPath(`${SUBAGENT_SESSION_DIR}/child/session.json`),
    ).toBe(true)
    expect(isSubagentSessionPath('/tmp/session.json')).toBe(false)
    expect(isSubagentSessionPath(undefined)).toBe(false)
  })

  test('extracts and sanitizes the session file path', () => {
    const sessionManager = {
      getSessionFile: () => '\n /tmp/example.json \t',
    }

    expect(extractSessionFilePath(sessionManager)).toBe('/tmp/example.json')
    expect(extractSessionFilePath({ getSessionFile: () => undefined })).toBe(
      undefined,
    )
    expect(extractSessionFilePath({ getSessionFile: 'nope' })).toBe(undefined)
    expect(extractSessionFilePath(null)).toBe(undefined)
  })

  test('formats the status line into a single clipped line', () => {
    const noisy = `  alpha\n beta\t${'x'.repeat(MAX_STATUS_CHARS)}  `
    const formatted = formatNameStatus(noisy)

    expect(formatted).not.toContain('\n')
    expect(formatted.length).toBeLessThanOrEqual(MAX_STATUS_CHARS)
  })

  test('builds the name context with truncation', () => {
    const message = 'm'.repeat(MAX_MESSAGE_LENGTH + 25)
    const context = buildNameContext(message)

    expect(context).toBe(
      `User message: ${message.slice(0, MAX_MESSAGE_LENGTH)}`,
    )
  })

  test('extracts text-only content and clips the result length', () => {
    const result = extractNameFromResult([
      { type: 'text', text: `  "${'a'.repeat(MAX_NAME_LENGTH)}" ` },
      { type: 'image', text: 'ignored' },
      { type: 'text', text: 'suffix' },
    ])

    expect(result).toBe('a'.repeat(MAX_NAME_LENGTH))
  })

  test('prompt explicitly forces English output', () => {
    expect(NAME_SYSTEM_PROMPT).toContain('English only')
  })
})
