import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import { Box, Container, Image, Text } from '@mariozechner/pi-tui'
import { type Static, Type } from 'typebox'

const TOOL_NAME = 'image_generation'
const COMMAND_NAME = 'image-generation'
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const DEFAULT_MODEL = 'gpt-5.5'
const DEFAULT_OUTPUT_FORMAT = 'png'
const DEFAULT_TIMEOUT_MS = 180_000
const TIMEOUT_ENV_VAR = 'PI_CODEX_IMAGE_GEN_TIMEOUT_MS'
const GENERATED_IMAGE_ARTIFACTS_DIR = 'generated_images'

const imageOutputFormats = ['png', 'jpeg', 'webp'] as const

type ImageOutputFormat = (typeof imageOutputFormats)[number]

type CodexImageCredentials = {
  accessToken: string
  accountId: string
  source: 'modelRegistry' | 'piAuthFile' | 'codexAuthFile'
}

type ImageInput = {
  path: string
  data: string
  mimeType: string
}

type ExtractedImageResult = {
  id: string
  status: string
  revised_prompt?: string
  result: string
  mimeType: string
}

type CodexImageResult = Omit<ExtractedImageResult, 'result'> & {
  type: 'image_generation_call'
  prompt: string
  model: string
  output_format: ImageOutputFormat
  saved_path: string
  byte_size: number
}

const imageGenerationSchema = Type.Object(
  {
    prompt: Type.String({
      description:
        'Image generation/editing prompt. Pass the user request verbatim unless the user explicitly asks you to refine or expand it.',
    }),
    images: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Optional local image paths to use as edit targets or visual references. Relative paths resolve from the current workspace.',
      }),
    ),
    model: Type.Optional(
      Type.String({
        description:
          'OpenAI Codex model to drive the hosted image_generation tool. Defaults to the current openai-codex model or gpt-5.5.',
      }),
    ),
    output_format: Type.Optional(
      Type.Union(
        [Type.Literal('png'), Type.Literal('jpeg'), Type.Literal('webp')],
        {
          description:
            'Generated image format. Codex currently registers image_generation with png by default.',
        },
      ),
    ),
    timeout_ms: Type.Optional(
      Type.Number({
        description:
          'Optional per-call timeout in milliseconds. Defaults to PI_CODEX_IMAGE_GEN_TIMEOUT_MS or 180000.',
        minimum: 1,
      }),
    ),
  },
  { additionalProperties: false },
)

type ImageGenerationParams = Static<typeof imageGenerationSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function extractAccountIdFromJwt(token: string): string | undefined {
  try {
    const [, payload] = token.split('.')
    if (!payload) return undefined
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown
    if (!isRecord(parsed)) return undefined
    const auth = parsed['https://api.openai.com/auth']
    if (!isRecord(auth)) return undefined
    const accountId = auth.chatgpt_account_id
    return typeof accountId === 'string' && accountId.trim()
      ? accountId.trim()
      : undefined
  } catch {
    return undefined
  }
}

function parseRegistryCredentials(
  raw: string | undefined,
): Omit<CodexImageCredentials, 'source'> | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (isRecord(parsed)) {
      const accessToken =
        typeof parsed.access === 'string'
          ? parsed.access
          : typeof parsed.token === 'string'
            ? parsed.token
            : undefined
      const accountId =
        typeof parsed.accountId === 'string'
          ? parsed.accountId
          : typeof parsed.account_id === 'string'
            ? parsed.account_id
            : undefined
      if (accessToken?.trim() && accountId?.trim()) {
        return {
          accessToken: accessToken.trim(),
          accountId: accountId.trim(),
        }
      }
    }
  } catch {
    // Plain bearer token is expected for openai-codex in pi.
  }
  const accountId = extractAccountIdFromJwt(value)
  return accountId ? { accessToken: value, accountId } : undefined
}

function readAuthFile(
  filePath: string,
): Omit<CodexImageCredentials, 'source'> | undefined {
  if (!existsSync(filePath)) return undefined
  try {
    const auth = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
      string,
      | {
          type?: string
          access?: string | null
          accountId?: string | null
          account_id?: string | null
        }
      | undefined
    >
    const entry = auth['openai-codex']
    if (entry?.type !== 'oauth') return undefined
    const accessToken = entry.access?.trim()
    const accountId = (entry.accountId ?? entry.account_id)?.trim()
    return accessToken && accountId ? { accessToken, accountId } : undefined
  } catch {
    return undefined
  }
}

function piAgentDir(): string {
  return (
    process.env.PI_CODING_AGENT_DIR?.trim() ||
    path.join(homedir(), '.pi', 'agent')
  )
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex')
}

async function getCredentials(
  ctx: ExtensionContext,
): Promise<CodexImageCredentials> {
  const registryToken = await ctx.modelRegistry
    .getApiKeyForProvider('openai-codex')
    .catch(() => undefined)
  const registryCredentials = parseRegistryCredentials(registryToken)
  if (registryCredentials) {
    return { ...registryCredentials, source: 'modelRegistry' }
  }

  const piAuth = readAuthFile(path.join(piAgentDir(), 'auth.json'))
  if (piAuth) return { ...piAuth, source: 'piAuthFile' }

  const codexAuth = readAuthFile(path.join(codexHome(), 'auth.json'))
  if (codexAuth) return { ...codexAuth, source: 'codexAuthFile' }

  throw new Error(
    'Missing openai-codex OAuth credentials. Run `/login openai-codex` in Pi, or log in with Codex so an openai-codex auth.json entry exists.',
  )
}

function imageMimeType(filePath: string, outputFormat?: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (outputFormat === 'jpeg') return 'image/jpeg'
  if (outputFormat === 'webp') return 'image/webp'
  return 'image/png'
}

function extensionForFormat(format: ImageOutputFormat): string {
  return format === 'jpeg' ? 'jpg' : format
}

async function readImageInputs(
  paths: string[] | undefined,
  cwd: string,
): Promise<ImageInput[]> {
  const inputs: ImageInput[] = []
  for (const rawPath of paths ?? []) {
    const trimmed = rawPath.trim()
    if (!trimmed) continue
    const imagePath = path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(cwd, trimmed)
    const data = (await readFile(imagePath)).toString('base64')
    inputs.push({ path: imagePath, data, mimeType: imageMimeType(imagePath) })
  }
  return inputs
}

function sanitizeArtifactComponent(value: string): string {
  const sanitized = value
    .split('')
    .map((character) => (/[A-Za-z0-9_-]/.test(character) ? character : '_'))
    .join('')
  return sanitized || 'generated_image'
}

function sessionArtifactId(ctx: ExtensionContext): string {
  const sessionFile = ctx.sessionManager.getSessionFile()
  if (sessionFile) return path.basename(sessionFile, path.extname(sessionFile))
  return 'pi'
}

function imageGenerationArtifactPath(
  ctx: ExtensionContext,
  callId: string,
  outputFormat: ImageOutputFormat,
): string {
  return path
    .join(
      codexHome(),
      GENERATED_IMAGE_ARTIFACTS_DIR,
      sanitizeArtifactComponent(sessionArtifactId(ctx)),
      `${sanitizeArtifactComponent(callId)}.${extensionForFormat(outputFormat)}`,
    )
    .toString()
}

function buildRequest(
  params: ImageGenerationParams,
  model: string,
  images: ImageInput[],
  outputFormat: ImageOutputFormat,
) {
  const content: Array<Record<string, unknown>> = [
    { type: 'input_text', text: params.prompt },
  ]
  for (const image of images) {
    content.push({
      type: 'input_image',
      detail: 'auto',
      image_url: `data:${image.mimeType};base64,${image.data}`,
    })
  }

  return {
    model,
    instructions: '',
    input: [{ role: 'user', content }],
    tools: [{ type: 'image_generation', output_format: outputFormat }],
    tool_choice: { type: 'image_generation' },
    parallel_tool_calls: false,
    store: false,
    stream: true,
    include: [],
    client_metadata: { 'x-codex-installation-id': 'pi-codex-image-gen' },
  }
}

function dataUrlParts(
  value: string,
  fallbackMimeType: string,
): { result: string; mimeType: string } {
  const match = value.match(/^data:([^;,]+);base64,(.*)$/s)
  if (match) {
    return {
      mimeType: match[1] || fallbackMimeType,
      result: (match[2] ?? '').trim(),
    }
  }
  return { result: value.trim(), mimeType: fallbackMimeType }
}

type ImageResultItem = {
  id?: string
  status?: string
  revised_prompt?: string
  result?: string
  b64_json?: string
}

function asImageResultItem(value: unknown): ImageResultItem | undefined {
  if (!isRecord(value) || value.type !== 'image_generation_call')
    return undefined
  return value as ImageResultItem
}

function imageResultData(item: ImageResultItem): string | undefined {
  if (typeof item.result === 'string' && item.result.trim()) {
    return item.result
  }
  if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
    return item.b64_json
  }
  return undefined
}

function extractImageFromEvent(
  event: unknown,
  fallbackMimeType: string,
): ExtractedImageResult | undefined {
  if (!isRecord(event)) return undefined
  const item = findImageResultItem(event)
  if (item) {
    const raw = imageResultData(item)
    if (!raw) return undefined
    const { result, mimeType } = dataUrlParts(raw, fallbackMimeType)
    return {
      id:
        typeof item.id === 'string'
          ? item.id
          : `ig_${randomUUID().slice(0, 8)}`,
      status: typeof item.status === 'string' ? item.status : 'completed',
      revised_prompt:
        typeof item.revised_prompt === 'string'
          ? item.revised_prompt
          : undefined,
      result,
      mimeType,
    }
  }

  const partial = event.partial_image_b64 ?? event.b64_json
  if (typeof partial === 'string' && partial.trim()) {
    const { result, mimeType } = dataUrlParts(partial, fallbackMimeType)
    return {
      id: `ig_${randomUUID().slice(0, 8)}`,
      status: 'partial',
      result,
      mimeType,
    }
  }
  return undefined
}

function findImageResultItem(
  event: Record<string, unknown>,
): ImageResultItem | undefined {
  const direct = asImageResultItem(event.item) ?? asImageResultItem(event)
  if (direct) return direct

  const responseOutput = isRecord(event.response)
    ? event.response.output
    : undefined
  const output = Array.isArray(responseOutput)
    ? responseOutput
    : Array.isArray(event.output)
      ? event.output
      : undefined
  if (!output) return undefined

  const imageItems = output.flatMap((item) => {
    const image = asImageResultItem(item)
    return image ? [image] : []
  })
  return (
    imageItems.find(
      (item) =>
        imageResultData(item) && (!item.status || item.status === 'completed'),
    ) ??
    imageItems.find((item) => imageResultData(item)) ??
    imageItems[0]
  )
}

function nextSseChunk(buffer: string):
  | {
      chunk: string
      rest: string
    }
  | undefined {
  const match = /\r?\n\r?\n/.exec(buffer)
  if (!match || match.index === undefined) return undefined
  return {
    chunk: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  }
}

function sseDataFromChunk(chunk: string): string {
  return chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()
}

async function parseSseForImage(
  response: Response,
  fallbackMimeType: string,
  signal?: AbortSignal,
): Promise<ExtractedImageResult> {
  if (!response.body)
    throw new Error('No response body from Codex image request.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastImage: ExtractedImageResult | undefined
  const processChunk = (chunk: string): ExtractedImageResult | undefined => {
    const data = sseDataFromChunk(chunk)
    if (!data || data === '[DONE]') return undefined

    const event = parseJson(data)
    const image = extractImageFromEvent(event, fallbackMimeType)
    if (image?.result) {
      lastImage = image
      if (image.status === 'completed') return image
    }
    const errorMessage = extractErrorMessage(event)
    if (errorMessage) throw new Error(errorMessage)
    return undefined
  }
  try {
    while (true) {
      if (signal?.aborted) throw new Error('Image request was aborted.')
      const { done, value } = await reader.read()
      if (done) {
        const final = buffer.trim() ? processChunk(buffer) : undefined
        if (final) return final
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let next = nextSseChunk(buffer)
      while (next) {
        buffer = next.rest
        const image = processChunk(next.chunk)
        if (image) {
          await reader.cancel().catch(() => undefined)
          return image
        }
        next = nextSseChunk(buffer)
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (lastImage) {
    if (lastImage.status === 'partial') {
      throw new Error(
        'Only partial image_generation_call previews were returned by Codex.',
      )
    }
    return lastImage
  }
  throw new Error('No image_generation_call result returned by Codex.')
}

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data) as unknown
  } catch {
    return undefined
  }
}

function extractErrorMessage(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined
  if (event.type === 'response.failed') {
    const error =
      isRecord(event.response) && isRecord(event.response.error)
        ? event.response.error
        : undefined
    return typeof error?.message === 'string'
      ? error.message
      : 'Codex image request failed.'
  }
  if (event.type === 'error') {
    return typeof event.message === 'string'
      ? `Codex image error: ${event.message}`
      : `Codex image error: ${JSON.stringify(event)}`
  }
  return undefined
}

function resolveModel(
  params: ImageGenerationParams,
  ctx: ExtensionContext,
): string {
  const model = params.model?.trim()
  if (model)
    return model.includes('/') ? model.split('/').pop() || model : model
  if (ctx.model?.provider === 'openai-codex') return ctx.model.id
  return DEFAULT_MODEL
}

function resolveOutputFormat(params: ImageGenerationParams): ImageOutputFormat {
  return params.output_format ?? DEFAULT_OUTPUT_FORMAT
}

function textFromMessageContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter(
      (part) =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string',
    )
    .map((part) => (part as { text: string }).text)
    .join('\n')
    .trim()
  return text || undefined
}

function latestUserPromptFromEntries(entries: unknown[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (
      !isRecord(entry) ||
      entry.type !== 'message' ||
      !isRecord(entry.message) ||
      entry.message.role !== 'user'
    ) {
      continue
    }
    const text = textFromMessageContent(entry.message.content)
    if (text) return text
  }
  return undefined
}

function resolveToolPrompt(
  params: ImageGenerationParams,
  _ctx: ExtensionContext,
): string {
  return params.prompt
}

function imageRequestTimeoutMs(
  params?: Pick<ImageGenerationParams, 'timeout_ms'>,
): number {
  if (
    typeof params?.timeout_ms === 'number' &&
    Number.isFinite(params.timeout_ms) &&
    params.timeout_ms > 0
  ) {
    return params.timeout_ms
  }
  const raw = process.env[TIMEOUT_ENV_VAR]?.trim()
  if (!raw) return DEFAULT_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

async function requestCodexImage(
  params: ImageGenerationParams,
  ctx: ExtensionContext,
  requestSignal?: AbortSignal,
): Promise<CodexImageResult> {
  const credentials = await getCredentials(ctx)
  const model = resolveModel(params, ctx)
  const outputFormat = resolveOutputFormat(params)
  const requestParams = { ...params, prompt: resolveToolPrompt(params, ctx) }
  const images = await readImageInputs(
    requestParams.images,
    ctx.cwd || process.cwd(),
  )
  const request = buildRequest(requestParams, model, images, outputFormat)
  const timeoutSignal = AbortSignal.timeout(
    imageRequestTimeoutMs(requestParams),
  )
  const signal = requestSignal
    ? AbortSignal.any([requestSignal, timeoutSignal])
    : timeoutSignal

  const response = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      'chatgpt-account-id': credentials.accountId,
      'OpenAI-Beta': 'responses=experimental',
      accept: 'text/event-stream',
      'content-type': 'application/json',
      originator: 'codex_cli_rs',
      'User-Agent': 'codex_cli_rs/0.0.0 (pi-codex-image-gen)',
    },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Codex image request failed (${response.status}): ${text || response.statusText}`,
    )
  }

  const parsed = await parseSseForImage(
    response,
    imageMimeType(`image.${outputFormat}`, outputFormat),
    signal,
  )
  const savedPath = imageGenerationArtifactPath(ctx, parsed.id, outputFormat)
  const imageBuffer = Buffer.from(parsed.result, 'base64')
  await mkdir(path.dirname(savedPath), { recursive: true })
  await writeFile(savedPath, Uint8Array.from(imageBuffer))

  return {
    id: parsed.id,
    status: parsed.status,
    revised_prompt: parsed.revised_prompt,
    mimeType: parsed.mimeType,
    type: 'image_generation_call',
    prompt: requestParams.prompt,
    model,
    output_format: outputFormat,
    saved_path: savedPath,
    byte_size: imageBuffer.byteLength,
  }
}

function displayPath(filePath: string): string {
  const home = homedir()
  if (!home) return filePath
  if (filePath === home) return '~'
  const homePrefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`
  return filePath.startsWith(homePrefix)
    ? `~/${filePath.slice(homePrefix.length)}`
    : filePath
}

function resultText(result: CodexImageResult): string {
  const parts = [
    'Generated Image:',
    `Prompt: ${result.prompt}`,
    `Saved to: file://${result.saved_path}`,
    `Size: ${result.byte_size} bytes`,
  ]
  if (result.revised_prompt) {
    parts.splice(2, 0, `Revised prompt: ${result.revised_prompt}`)
  }
  return parts.join('\n')
}

function readSavedImageBase64(result: CodexImageResult): string | undefined {
  try {
    return readFileSync(result.saved_path).toString('base64')
  } catch {
    return undefined
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (part) =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string',
    )
    .map((part) => (part as { text: string }).text)
    .join('\n')
}

function imageResultComponent(
  result: CodexImageResult,
  text: string,
  theme: { fg: (color: 'dim' | 'warning', text: string) => string },
  showImages: boolean,
): Container {
  const container = new Container()
  container.addChild(new Text(text, 0, 0))
  if (!showImages) return container

  const imageBase64 = readSavedImageBase64(result)
  if (!imageBase64) {
    container.addChild(
      new Text(
        theme.fg('warning', `Image file not found: ${result.saved_path}`),
        0,
        0,
      ),
    )
    return container
  }

  container.addChild(
    new Image(
      imageBase64,
      result.mimeType,
      { fallbackColor: (line: string) => theme.fg('dim', line) },
      {
        maxWidthCells: 80,
        maxHeightCells: 24,
        filename: result.saved_path,
      },
    ),
  )
  return container
}

function registerRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<CodexImageResult>(
    'image_generation_call',
    (message, _options, theme) => {
      const result = message.details
      const text =
        result && isRecord(result)
          ? resultText(result as CodexImageResult)
          : textFromContent(message.content)
      const container = new Container()
      const box = new Box(1, 1, (line: string) =>
        theme.bg('customMessageBg', line),
      )
      if (
        result &&
        isRecord(result) &&
        typeof result.saved_path === 'string' &&
        typeof result.mimeType === 'string'
      ) {
        box.addChild(
          imageResultComponent(
            result as CodexImageResult,
            `${theme.fg('accent', theme.bold('[image_generation]'))}\n\n${text}`,
            theme,
            true,
          ),
        )
      } else {
        box.addChild(
          new Text(
            `${theme.fg('accent', theme.bold('[image_generation]'))}\n\n${text}`,
            0,
            0,
          ),
        )
      }
      container.addChild(box)
      return container
    },
  )
}

export default function codexImageGeneration(pi: ExtensionAPI) {
  registerRenderer(pi)

  pi.registerCommand(COMMAND_NAME, {
    description: 'Generate an image with Codex image_generation',
    handler: async (args, ctx) => {
      const prompt = args.trim()
      if (!prompt) {
        ctx.ui.notify(`Usage: /${COMMAND_NAME} <prompt>`, 'error')
        return
      }
      ctx.ui.notify('Requesting Codex image_generation...', 'info')
      const result = await requestCodexImage({ prompt }, ctx, ctx.signal)
      pi.sendMessage({
        customType: 'image_generation_call',
        content: [{ type: 'text', text: resultText(result) }],
        display: true,
        details: result,
      })
    },
  })

  pi.registerTool({
    name: TOOL_NAME,
    label: 'Image Generation',
    description:
      'Generate or edit images through the hosted Codex/OpenAI Responses API image_generation tool. This Pi compatibility shim mirrors Codex native image_generation as closely as possible and saves completed images under CODEX_HOME/generated_images.',
    promptSnippet:
      'Generate or edit raster images via the Codex-compatible `image_generation` tool.',
    promptGuidelines: [
      'Use image_generation when the user asks to generate or edit a raster image, photo, illustration, mockup, texture, sprite, or bitmap asset.',
      'Pass the user request verbatim in image_generation.prompt unless the user explicitly asks you to refine or expand it.',
      'image_generation saves generated images under CODEX_HOME/generated_images by default; copy or move the saved file into the workspace if the user needs a project asset.',
      'Do not describe or rely on a destination-path argument for image_generation. Generate first, then copy or move the saved artifact if a specific location is needed.',
    ],
    parameters: imageGenerationSchema,
    executionMode: 'sequential',
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial || !isRecord(result.details)) {
        return new Text(textFromContent(result.content), 0, 0)
      }
      const details = result.details
      if (
        typeof details.saved_path !== 'string' ||
        typeof details.mimeType !== 'string'
      ) {
        return new Text(textFromContent(result.content), 0, 0)
      }
      return imageResultComponent(
        details as CodexImageResult,
        textFromContent(result.content),
        theme,
        context.showImages,
      )
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const model = resolveModel(params, ctx)
      const outputFormat = resolveOutputFormat(params)
      const timeoutMs = imageRequestTimeoutMs(params)
      onUpdate?.({
        content: [
          {
            type: 'text',
            text: `Requesting Codex image_generation via openai-codex/${model} (${outputFormat}, timeout ${Math.round(timeoutMs / 1000)}s)...`,
          },
        ],
        details: undefined,
      })
      const result = await requestCodexImage(params, ctx, signal)
      return {
        content: [{ type: 'text', text: resultText(result) }],
        details: result,
      }
    },
  })
}

export const _test = {
  TOOL_NAME,
  COMMAND_NAME,
  CODEX_RESPONSES_URL,
  DEFAULT_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_TIMEOUT_MS,
  TIMEOUT_ENV_VAR,
  GENERATED_IMAGE_ARTIFACTS_DIR,
  imageMimeType,
  extensionForFormat,
  dataUrlParts,
  extractImageFromEvent,
  parseSseForImage,
  buildRequest,
  displayPath,
  resultText,
  readSavedImageBase64,
  latestUserPromptFromEntries,
  resolveToolPrompt,
  imageRequestTimeoutMs,
  sanitizeArtifactComponent,
}
