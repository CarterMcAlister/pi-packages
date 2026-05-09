import { getApiProvider, getModels } from '@earendil-works/pi-ai'
import type { AccountManager } from './account-manager'
import { createStreamWrapper } from './stream-wrapper'

export const PROVIDER_ID = 'openai-codex'

export interface ProviderModelDef {
  id: string
  name: string
  reasoning: boolean
  input: ('text' | 'image')[]
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
  contextWindow: number
  maxTokens: number
}

export function getOpenAICodexMirror(): {
  baseUrl: string
  models: ProviderModelDef[]
} {
  const sourceModels = getModels('openai-codex')
  if (sourceModels.length === 0) {
    return { baseUrl: 'https://chatgpt.com/backend-api', models: [] }
  }
  const baseUrl = sourceModels[0]?.baseUrl ?? 'https://chatgpt.com/backend-api'
  return {
    baseUrl,
    models: sourceModels.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      input: [...m.input],
      cost: { ...m.cost },
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    })),
  }
}

function getActiveApiKey(accountManager: AccountManager): string {
  const active = accountManager.getActiveAccount()
  if (active && !active.needsReauth) {
    return active.accessToken
  }
  // Fallback: first available account with a valid token.
  for (const account of accountManager.getAccounts()) {
    if (!account.needsReauth && account.accessToken) {
      return account.accessToken
    }
  }
  // Fallback placeholder until MultiCodex resolves a usable managed account.
  return 'pending-login'
}

export function buildMulticodexProviderConfig(accountManager: AccountManager) {
  const mirror = getOpenAICodexMirror()
  const baseProvider = getApiProvider('openai-codex-responses')
  if (!baseProvider) {
    throw new Error(
      'OpenAI Codex provider not available. Please update pi to include openai-codex support.',
    )
  }

  return {
    baseUrl: mirror.baseUrl,
    apiKey: getActiveApiKey(accountManager),
    api: 'openai-codex-responses' as const,
    streamSimple: createStreamWrapper(accountManager, baseProvider),
    models: mirror.models,
  }
}
