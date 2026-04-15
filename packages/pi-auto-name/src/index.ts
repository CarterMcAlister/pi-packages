import * as path from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import {
  buildNameContext,
  extractNameFromResult,
  extractSessionFilePath,
  formatNameStatus,
  isSubagentSessionPath,
  NAME_SYSTEM_PROMPT,
} from './auto-name-utils.ts'
import { generateShortLabel } from './short-label.ts'

const NAME_STATUS_KEY = 'name-footer'

function isSubagentSession(ctx: ExtensionContext): boolean {
  const sessionFilePath = extractSessionFilePath(ctx.sessionManager)
  return isSubagentSessionPath(sessionFilePath)
}

async function detectNameFromMessage(
  userMessage: string,
  ctx: ExtensionContext,
): Promise<string> {
  return generateShortLabel(ctx, {
    systemPrompt: NAME_SYSTEM_PROMPT,
    prompt: buildNameContext(userMessage),
    extractText: extractNameFromResult,
  })
}

export default function autoSessionName(pi: ExtensionAPI) {
  const updateTerminalTitle = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return

    const cwdBasename = path.basename(process.cwd())
    const name = pi.getSessionName()
    if (!name) return

    ctx.ui.setTitle(`π - ${name} - ${cwdBasename}`)
  }

  const updateStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return

    const name = pi.getSessionName()
    if (!name) {
      ctx.ui.setStatus(NAME_STATUS_KEY, undefined)
      return
    }

    ctx.ui.setStatus(NAME_STATUS_KEY, formatNameStatus(name))
    updateTerminalTitle(ctx)
  }

  pi.on('before_agent_start', async (event, ctx) => {
    if (isSubagentSession(ctx)) return
    if (pi.getSessionName()) return

    const text = event.prompt.trim()
    if (!text) return

    void (async () => {
      try {
        const detected = await detectNameFromMessage(text, ctx)
        if (detected && !pi.getSessionName()) {
          pi.setSessionName(detected)
          updateStatus(ctx)
        }
      } catch {
        // Leave the session unnamed on failures.
      }
    })()
  })

  pi.on('session_start', async (_event, ctx) => {
    updateStatus(ctx)
  })

  pi.on('session_tree', async (_event, ctx) => {
    updateStatus(ctx)
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    if (!ctx.hasUI) return
    ctx.ui.setStatus(NAME_STATUS_KEY, undefined)
  })
}
