import type { AxTaskPrepareContext } from '../types'

export async function loadTextContext(
  context: AxTaskPrepareContext,
  taskLabel: string,
): Promise<string> {
  const inlineText = context.inputs.text?.trim()
  if (inlineText) {
    return inlineText
  }

  const filePath = context.inputs.file?.trim() ?? context.inputs.path?.trim()
  if (filePath) {
    return context.helpers.readTextFile(filePath)
  }

  throw new Error(
    `${taskLabel} requires either an "text" input or a "file" path.`,
  )
}

export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string')
}
