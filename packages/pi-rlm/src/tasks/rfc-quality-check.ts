import { AxJSRuntime, agent } from '@ax-llm/ax'
import type { AxTaskDefinition } from '../types'
import { asStringList, loadTextContext } from './shared'

interface RfcQualityResult extends Record<string, unknown> {
  answer: string
  readiness: string
  strengths: string[]
  gaps: string[]
  openQuestions: string[]
}

const rfcQualityCheckTask: AxTaskDefinition<RfcQualityResult> = {
  id: 'rfc-quality-check',
  description:
    'Review an RFC or design proposal for clarity, completeness, trade-offs, and approval readiness.',
  inputSchema: {
    file: 'Path to an RFC or design document',
    text: 'Raw RFC text',
    audience: 'Optional audience such as reviewers or approvers',
  },
  examples: [
    'Use rfc-quality-check on docs/rfcs/023-authz.md.',
    'Run rfc-quality-check on this proposal and focus on approval readiness.',
  ],
  async prepare(context) {
    const documentText = await loadTextContext(context, 'rfc-quality-check')
    const audience = context.inputs.audience?.trim() || undefined
    const filePath = context.inputs.file?.trim() ?? context.inputs.path?.trim()

    if (filePath) {
      context.onStatus(`Loaded ${filePath}`, 'success')
    }

    const reviewAgent = agent(
      'context:string, audience?:string, audienceAnswer?:string, query?:string -> answer:string, readiness:string, strengths:string[], gaps:string[], openQuestions:string[]',
      {
        contextFields: ['context'],
        runtime: new AxJSRuntime(),
        maxTurns: 10,
        mode: 'simple',
        contextPolicy: {
          preset: 'checkpointed',
          budget: 'balanced',
        },
        actorOptions: {
          description: [
            'You are reviewing an RFC or design proposal for decision quality.',
            'If audience is missing and audienceAnswer is missing, ask for clarification before finalizing.',
            'Treat audienceAnswer as the audience when provided.',
            'Look for problem framing, scope, alternatives, trade-offs, risks, rollout plan, and unanswered questions.',
            'Return a readiness judgment plus concise strengths, gaps, and open questions.',
            'Use query as additional focus guidance when provided.',
          ].join('\n'),
        },
        agentStatusCallback: (message, status) => {
          context.onStatus(message, status === 'failed' ? 'failed' : 'success')
        },
      },
    ) as unknown as {
      forward(
        ai: unknown,
        inputs: Record<string, unknown>,
      ): Promise<RfcQualityResult>
      setState?(state: unknown): void
    }

    return {
      agent: reviewAgent,
      inputs: {
        context: documentText,
        audience,
        audienceAnswer: undefined,
        query: context.query,
      },
      clarification: {
        answerField: 'audienceAnswer',
      },
    }
  },
  formatResult({ result }) {
    const summary = result.answer || 'No summary returned.'
    const strengths = asStringList(result.strengths)
    const gaps = asStringList(result.gaps)
    const openQuestions = asStringList(result.openQuestions)
    const readiness =
      typeof result.readiness === 'string' && result.readiness.trim().length > 0
        ? result.readiness
        : 'undetermined'

    const markdown = [
      '## Summary',
      summary,
      '',
      '## Readiness',
      `- ${readiness}`,
      '',
      '## Strengths',
      ...(strengths.length > 0
        ? strengths.map((item) => `- ${item}`)
        : ['- No strengths captured']),
      '',
      '## Gaps',
      ...(gaps.length > 0
        ? gaps.map((item) => `- ${item}`)
        : ['- No gaps flagged']),
      '',
      '## Open Questions',
      ...(openQuestions.length > 0
        ? openQuestions.map((item) => `- ${item}`)
        : ['- No open questions listed']),
    ].join('\n')

    return {
      summary,
      markdown,
      result,
    }
  },
}

export default rfcQualityCheckTask
