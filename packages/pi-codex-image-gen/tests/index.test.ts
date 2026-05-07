import { afterEach, expect, test } from 'bun:test'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import { _test } from '../src/index'

function responseFromSse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
  )
}

function contextWithLatestUserPrompt(prompt: string): ExtensionContext {
  return {
    sessionManager: {
      getEntries: () => [
        {
          type: 'message',
          message: {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        },
      ],
    },
  } as unknown as ExtensionContext
}

afterEach(() => {
  delete process.env[_test.TIMEOUT_ENV_VAR]
})

test('resolveToolPrompt uses the explicit tool prompt, not the latest user message', () => {
  const prompt = _test.resolveToolPrompt(
    { prompt: 'actual image prompt' },
    contextWithLatestUserPrompt('give it a longer time before timeout'),
  )

  expect(prompt).toBe('actual image prompt')
})

test('parseSseForImage handles CRLF-delimited final response output events', async () => {
  const response = responseFromSse([
    `data: ${JSON.stringify({
      type: 'response.completed',
      response: {
        output: [
          {
            type: 'image_generation_call',
            id: 'ig_final',
            status: 'completed',
            result: 'aW1hZ2U=',
          },
        ],
      },
    })}\r\n\r\n`,
  ])

  const image = await _test.parseSseForImage(response, 'image/png')

  expect(image.id).toBe('ig_final')
  expect(image.status).toBe('completed')
  expect(image.result).toBe('aW1hZ2U=')
})

test('parseSseForImage does not treat partial image previews as final output', async () => {
  const response = responseFromSse([
    `data: ${JSON.stringify({
      type: 'response.image_generation_call.partial_image',
      partial_image_b64: 'cGFydGlhbA==',
    })}\n\n`,
    'data: [DONE]\n\n',
  ])

  await expect(_test.parseSseForImage(response, 'image/png')).rejects.toThrow(
    'Only partial image_generation_call previews were returned by Codex.',
  )
})

test('parseSseForImage accepts final image bytes even when Codex leaves status as generating', async () => {
  const response = responseFromSse([
    `data: ${JSON.stringify({
      type: 'response.image_generation_call.generating',
      item: {
        type: 'image_generation_call',
        id: 'ig_generating',
        status: 'generating',
        result: 'aW1hZ2U=',
      },
    })}\n\n`,
    'data: [DONE]\n\n',
  ])

  const image = await _test.parseSseForImage(response, 'image/png')

  expect(image.id).toBe('ig_generating')
  expect(image.status).toBe('generating')
  expect(image.result).toBe('aW1hZ2U=')
})

test('extractImageFromEvent prefers completed output items over incomplete ones', () => {
  const image = _test.extractImageFromEvent(
    {
      type: 'response.completed',
      response: {
        output: [
          {
            type: 'image_generation_call',
            id: 'ig_preview',
            status: 'in_progress',
            result: 'cHJldmlldw==',
          },
          {
            type: 'image_generation_call',
            id: 'ig_final',
            status: 'completed',
            result: 'ZmluYWw=',
          },
        ],
      },
    },
    'image/png',
  )

  expect(image?.id).toBe('ig_final')
  expect(image?.result).toBe('ZmluYWw=')
})

test('imageRequestTimeoutMs can be configured with an environment variable', () => {
  process.env[_test.TIMEOUT_ENV_VAR] = '300000'

  expect(_test.imageRequestTimeoutMs()).toBe(300000)
})

test('imageRequestTimeoutMs prefers the per-call timeout over the environment variable', () => {
  process.env[_test.TIMEOUT_ENV_VAR] = '300000'

  expect(_test.imageRequestTimeoutMs({ timeout_ms: 600000 })).toBe(600000)
})
