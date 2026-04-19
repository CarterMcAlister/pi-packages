import { expect, test } from 'bun:test'
import { parseModelPreference, resolveAxModel } from '../src/model'

test('parses provider/model overrides', () => {
  expect(parseModelPreference('anthropic/claude-sonnet-4')).toEqual({
    provider: 'anthropic',
    modelId: 'claude-sonnet-4',
  })
})

test('normalizes openai-codex provider aliases', () => {
  expect(parseModelPreference('openai-codex/gpt-5.4')).toEqual({
    provider: 'openai',
    modelId: 'gpt-5.4',
  })
})

test('infers provider from plain model ids when possible', () => {
  expect(parseModelPreference('gemini-2.5-flash')).toEqual({
    provider: 'google-gemini',
    modelId: 'gemini-2.5-flash',
  })
})

test('resolves the active Pi model by default', async () => {
  const ctx = {
    model: {
      provider: 'anthropic',
      id: 'claude-sonnet-4-20250514',
    },
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return {
          ok: true,
          apiKey: 'test-key',
          headers: {},
        }
      },
      find() {
        return undefined
      },
    },
  }

  const resolved = await resolveAxModel(ctx as never)

  expect(resolved.spec).toBe('anthropic/claude-sonnet-4-20250514')
  expect(resolved.source).toBe('active')
})

test('supports plain-text overrides when Pi knows the target model', async () => {
  const ctx = {
    model: {
      provider: 'anthropic',
      id: 'claude-sonnet-4-20250514',
    },
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return {
          ok: true,
          apiKey: 'test-key',
          headers: {},
        }
      },
      find(provider: string, modelId: string) {
        return { provider, id: modelId }
      },
    },
  }

  const resolved = await resolveAxModel(ctx as never, 'openai/gpt-4.1')

  expect(resolved.spec).toBe('openai/gpt-4.1')
  expect(resolved.source).toBe('override')
})
