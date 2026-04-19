import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ai } from '@ax-llm/ax'
import type { Api, Model } from '@mariozechner/pi-ai'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import type { ResolvedAxModel, ResolvedPiModel } from './types'

const PROVIDER_ALIASES: Record<string, readonly string[]> = {
  anthropic: ['anthropic'],
  openai: ['openai', 'openai-codex', 'codex'],
  'google-gemini': ['google-gemini', 'google', 'gemini'],
}

interface PiModelLike {
  provider?: string
  id?: string
}

interface PiSettingsLike {
  defaultProvider?: string
  defaultModel?: string
}

interface ParsedModelPreference {
  provider: string
  modelId: string
}

type ModelSource = 'active' | 'override' | 'task-default' | 'settings-default'

export function normalizeProvider(
  provider: string | undefined,
): string | undefined {
  if (!provider) {
    return undefined
  }

  const lower = provider.toLowerCase()
  return Object.entries(PROVIDER_ALIASES).find(([, aliases]) =>
    aliases.includes(lower),
  )?.[0]
}

function inferProviderFromModelId(modelId: string): string | undefined {
  const lower = modelId.toLowerCase()

  if (lower.includes('claude')) {
    return 'anthropic'
  }

  if (
    lower.startsWith('gpt') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4')
  ) {
    return 'openai'
  }

  if (lower.includes('gemini')) {
    return 'google-gemini'
  }

  return undefined
}

async function readUserPiSettings(): Promise<PiSettingsLike | undefined> {
  const settingsPath = join(homedir(), '.pi', 'agent', 'settings.json')
  if (!existsSync(settingsPath)) {
    return undefined
  }

  try {
    const raw = await Bun.file(settingsPath).text()
    return JSON.parse(raw) as PiSettingsLike
  } catch {
    return undefined
  }
}

export function parseModelPreference(
  modelPreference: string | undefined,
  fallbackProvider?: string,
): ParsedModelPreference | undefined {
  const raw = modelPreference?.trim()
  if (!raw) {
    return undefined
  }

  const slashIndex = raw.indexOf('/')
  if (slashIndex !== -1) {
    const provider = normalizeProvider(raw.slice(0, slashIndex).trim())
    const modelId = raw.slice(slashIndex + 1).trim()

    if (!provider || !modelId) {
      throw new Error(
        `Invalid model preference "${raw}". Use provider/model, for example anthropic/claude-sonnet-4.`,
      )
    }

    return { provider, modelId }
  }

  const fallback = normalizeProvider(fallbackProvider)
  if (fallback) {
    return {
      provider: fallback,
      modelId: raw,
    }
  }

  const inferredProvider = inferProviderFromModelId(raw)
  if (!inferredProvider) {
    throw new Error(
      `Unable to infer a provider from model preference "${raw}". Use provider/model.`,
    )
  }

  return {
    provider: inferredProvider,
    modelId: raw,
  }
}

function parsePiModelPreference(
  modelPreference: string | undefined,
  fallbackProvider?: string,
): ParsedModelPreference | undefined {
  const raw = modelPreference?.trim()
  if (!raw) {
    return undefined
  }

  const slashIndex = raw.indexOf('/')
  if (slashIndex !== -1) {
    const provider = raw.slice(0, slashIndex).trim()
    const modelId = raw.slice(slashIndex + 1).trim()

    if (!provider || !modelId) {
      throw new Error(`Invalid model preference "${raw}". Use provider/model.`)
    }

    return { provider, modelId }
  }

  if (fallbackProvider?.trim()) {
    return {
      provider: fallbackProvider.trim(),
      modelId: raw,
    }
  }

  const inferredProvider = inferProviderFromModelId(raw)
  if (!inferredProvider) {
    throw new Error(
      `Unable to infer a provider from model preference "${raw}". Use provider/model.`,
    )
  }

  return {
    provider: inferredProvider,
    modelId: raw,
  }
}

function findPiModel(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
): Model<Api> | undefined {
  const candidates = [
    provider,
    normalizeProvider(provider),
    ...Object.entries(PROVIDER_ALIASES)
      .filter(([canonical]) => canonical === normalizeProvider(provider))
      .flatMap(([, aliases]) => aliases),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const found = ctx.modelRegistry.find?.(candidate, modelId)
    if (found) {
      return found
    }
  }

  return undefined
}

async function resolveRequestedModel(
  ctx: ExtensionContext,
  overrideModel?: string,
  taskDefaultModel?: string,
): Promise<{
  requested: ParsedModelPreference
  source: ModelSource
  activeModel?: PiModelLike
}> {
  const activeModel = (ctx.model ?? undefined) as PiModelLike | undefined
  const settings = await readUserPiSettings()

  const requested = parsePiModelPreference(
    overrideModel ?? taskDefaultModel,
    activeModel?.provider,
  )

  if (requested) {
    return {
      requested,
      source: overrideModel ? 'override' : 'task-default',
      activeModel,
    }
  }

  if (activeModel?.provider && activeModel.id) {
    return {
      requested: {
        provider: activeModel.provider,
        modelId: activeModel.id,
      },
      source: 'active',
      activeModel,
    }
  }

  const settingsRequested = parsePiModelPreference(
    settings?.defaultModel,
    settings?.defaultProvider,
  )
  if (settingsRequested) {
    return {
      requested: settingsRequested,
      source: 'settings-default',
      activeModel,
    }
  }

  throw new Error(
    'No active Pi model is available. Select a model first or pass a provider/model override.',
  )
}

export async function resolvePiModel(
  ctx: ExtensionContext,
  overrideModel?: string,
  taskDefaultModel?: string,
): Promise<ResolvedPiModel> {
  const { requested, source, activeModel } = await resolveRequestedModel(
    ctx,
    overrideModel,
    taskDefaultModel,
  )

  const model =
    activeModel?.provider === requested.provider &&
    activeModel.id === requested.modelId &&
    ctx.model
      ? ctx.model
      : findPiModel(ctx, requested.provider, requested.modelId)

  if (!model) {
    throw new Error(
      `Pi does not have a configured model entry for ${requested.provider}/${requested.modelId}.`,
    )
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders?.(model)
  if (!auth?.ok) {
    throw new Error(
      auth?.error ??
        `Failed to resolve credentials for ${requested.provider}/${requested.modelId}.`,
    )
  }

  const authHeaders =
    typeof auth.headers === 'object' && auth.headers !== null
      ? (auth.headers as Record<string, string>)
      : undefined

  return {
    model,
    provider: model.provider,
    modelId: model.id,
    spec: `${model.provider}/${model.id}`,
    source,
    apiKey: auth.apiKey,
    headers: authHeaders,
  }
}

export async function resolveAxModel(
  ctx: ExtensionContext,
  overrideModel?: string,
  taskDefaultModel?: string,
): Promise<ResolvedAxModel> {
  const resolved = await resolvePiModel(ctx, overrideModel, taskDefaultModel)

  if (
    !resolved.apiKey &&
    (!resolved.headers || Object.keys(resolved.headers).length === 0)
  ) {
    throw new Error(
      `Pi resolved ${resolved.spec}, but no API key or auth headers are available for Ax to use.`,
    )
  }

  const aiService = ai({
    name: normalizeProvider(resolved.provider) as never,
    apiKey: resolved.apiKey,
    headers: resolved.headers,
    config: {
      model: resolved.modelId,
    },
  } as never)

  return {
    ai: aiService,
    provider: normalizeProvider(resolved.provider) ?? resolved.provider,
    modelId: resolved.modelId,
    spec: `${normalizeProvider(resolved.provider) ?? resolved.provider}/${resolved.modelId}`,
    source: resolved.source,
  }
}

export const resolveRlmModel = resolvePiModel
