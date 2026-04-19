import { AxJSRuntime, agent } from '@ax-llm/ax'
import type { AxTaskDefinition } from '../types'
import { asStringList, loadTextContext } from './shared'

interface IncidentReviewResult extends Record<string, unknown> {
  answer: string
  severity: string
  evidence: string[]
  missingItems: string[]
  nextSteps: string[]
}

const incidentReviewTask: AxTaskDefinition<IncidentReviewResult> = {
  id: 'incident-review',
  description:
    'Review an incident write-up against an operational incident rubric and produce a manager-ready brief with gaps and next steps.',
  inputSchema: {
    file: 'Path to an incident document to review',
    text: 'Raw incident write-up text',
    audience: 'Optional target audience, e.g. engineering managers',
  },
  examples: [
    'Run incident-review on docs/incidents/checkout.md for engineering managers.',
    'Use incident-review on this pasted incident draft and highlight missing items.',
  ],
  async prepare(context) {
    const incidentText = await loadTextContext(context, 'incident-review')
    const audience = context.inputs.audience?.trim() || undefined
    const filePath = context.inputs.file?.trim() ?? context.inputs.path?.trim()

    if (filePath) {
      context.onStatus(`Loaded ${filePath}`, 'success')
    }

    const reviewAgent = agent(
      'context:string, audience?:string, audienceAnswer?:string, query?:string -> answer:string, severity:string, evidence:string[], missingItems:string[], nextSteps:string[]',
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
            'You are reviewing an incident write-up against a reliability rubric.',
            'If audience is missing and audienceAnswer is missing, ask for clarification before producing the final brief.',
            'Treat audienceAnswer as the audience when provided.',
            'Look for customer impact, severity framing, mitigation, recovery confirmation, follow-up owners, and postmortem readiness.',
            'Return concise findings with evidence grounded in the provided context.',
            'If query is present, use it as additional focus guidance.',
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
      ): Promise<IncidentReviewResult>
      setState?(state: unknown): void
    }

    return {
      agent: reviewAgent,
      inputs: {
        context: incidentText,
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
    const evidence = asStringList(result.evidence)
    const missingItems = asStringList(result.missingItems)
    const nextSteps = asStringList(result.nextSteps)
    const severity =
      typeof result.severity === 'string' && result.severity.trim().length > 0
        ? result.severity
        : 'unspecified'

    const markdown = [
      '## Summary',
      summary,
      '',
      '## Severity',
      `- ${severity}`,
      '',
      '## Evidence',
      ...(evidence.length > 0
        ? evidence.map((item) => `- ${item}`)
        : ['- None captured']),
      '',
      '## Missing Items',
      ...(missingItems.length > 0
        ? missingItems.map((item) => `- ${item}`)
        : ['- No major omissions flagged']),
      '',
      '## Next Steps',
      ...(nextSteps.length > 0
        ? nextSteps.map((item) => `- ${item}`)
        : ['- No next steps suggested']),
    ].join('\n')

    return {
      summary,
      markdown,
      result,
    }
  },
}

export default incidentReviewTask
