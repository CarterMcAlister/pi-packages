import { AxAgentClarificationError } from '@ax-llm/ax'
import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import type {
  AxClarificationAnswer,
  AxClarificationChoice,
  AxClarificationPrompt,
} from './types'

interface AxClarificationErrorLike extends Error {
  question?: string
  clarification?: unknown
  getState?(): unknown
}

function asChoice(
  value: string | AxClarificationChoice,
): AxClarificationChoice {
  if (typeof value === 'string') {
    return {
      label: value,
      value,
    }
  }

  return value
}

export function isAxClarificationError(
  error: unknown,
): error is AxClarificationErrorLike {
  return (
    error instanceof AxAgentClarificationError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as Error).name === 'AxAgentClarificationError')
  )
}

export function normalizeClarification(
  payload: unknown,
): AxClarificationPrompt {
  if (typeof payload === 'string') {
    return {
      question: payload,
      type: 'text',
    }
  }

  if (typeof payload === 'object' && payload !== null) {
    const question =
      typeof (payload as { question?: unknown }).question === 'string'
        ? (payload as { question: string }).question
        : undefined

    if (!question) {
      throw new Error('Received an invalid Ax clarification payload.')
    }

    const type =
      typeof (payload as { type?: unknown }).type === 'string'
        ? (payload as { type: AxClarificationPrompt['type'] }).type
        : 'text'

    const rawChoices = Array.isArray((payload as { choices?: unknown }).choices)
      ? ((payload as { choices: Array<string | AxClarificationChoice> })
          .choices ?? [])
      : []

    return {
      question,
      type,
      choices: rawChoices,
    }
  }

  throw new Error('Received an invalid Ax clarification payload.')
}

export async function promptForClarification(
  ctx: ExtensionContext,
  clarification: AxClarificationPrompt,
): Promise<AxClarificationAnswer | null> {
  if (!ctx.hasUI) {
    return null
  }

  const promptType = clarification.type ?? 'text'
  const question = clarification.question
  const choices = (clarification.choices ?? []).map(asChoice)

  switch (promptType) {
    case 'single_choice': {
      const selected = await ctx.ui.select(
        question,
        choices.map((choice) => choice.label),
      )
      const resolved = choices.find((choice) => choice.label === selected)
      return resolved?.value ?? null
    }
    case 'multiple_choice': {
      const placeholder =
        choices.length > 0
          ? `Comma-separated values (${choices
              .map((choice) => choice.value)
              .join(', ')})`
          : 'Comma-separated values'
      const answer = await ctx.ui.input(question, placeholder)
      if (!answer?.trim()) {
        return null
      }
      return answer
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    case 'number':
      return (await ctx.ui.input(question, 'Enter a number')) ?? null
    case 'date':
      return (await ctx.ui.input(question, 'YYYY-MM-DD')) ?? null
    default:
      return (await ctx.ui.input(question, 'Type your answer')) ?? null
  }
}
