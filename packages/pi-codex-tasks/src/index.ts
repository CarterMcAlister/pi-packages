import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'

const WIDGET_KEY = 'pi-codex-tasks'

type StepStatus = 'pending' | 'in_progress' | 'completed'

interface PlanItem {
  step: string
  status: StepStatus
}

interface WidgetUi {
  setWidget(key: string, lines: string[]): void
}

const updatePlanSchema = Type.Object(
  {
    explanation: Type.Optional(Type.String()),
    plan: Type.Array(
      Type.Object(
        {
          step: Type.String(),
          status: Type.Unsafe<StepStatus>({
            type: 'string',
            enum: ['pending', 'in_progress', 'completed'],
            description: 'One of: pending, in_progress, completed',
          }),
        },
        { additionalProperties: false },
      ),
      { description: 'The list of steps' },
    ),
  },
  { additionalProperties: false },
)

type UpdatePlanArgs = Static<typeof updatePlanSchema>

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    details: {},
    ...(isError ? { isError: true } : {}),
  }
}

function statusIcon(status: StepStatus): string {
  if (status === 'completed') return '✔'
  if (status === 'in_progress') return '◼'
  return '◻'
}

function validatePlan(plan: PlanItem[]): string | undefined {
  const inProgressCount = plan.filter(
    (item) => item.status === 'in_progress',
  ).length
  if (inProgressCount > 1) {
    return 'At most one plan step can be in_progress at a time.'
  }
  return undefined
}

export default function registerCodexTasks(pi: ExtensionAPI): void {
  let latestUi: WidgetUi | undefined
  let currentPlan: PlanItem[] = []

  function updateWidget(): void {
    if (!latestUi) return
    if (currentPlan.length === 0) {
      latestUi.setWidget(WIDGET_KEY, [])
      return
    }

    const completed = currentPlan.filter(
      (item) => item.status === 'completed',
    ).length
    latestUi.setWidget(WIDGET_KEY, [
      `● plan (${completed}/${currentPlan.length} completed)`,
      ...currentPlan.map((item) => `  ${statusIcon(item.status)} ${item.step}`),
    ])
  }

  function rememberUi(ctx: ExtensionContext): void {
    latestUi = ctx.ui as WidgetUi
    updateWidget()
  }

  pi.on('before_agent_start', async (_event, ctx) => rememberUi(ctx))
  pi.on('tool_execution_start', async (_event, ctx) => rememberUi(ctx))
  pi.on('session_switch' as never, async (_event, ctx) => {
    currentPlan = []
    rememberUi(ctx)
  })

  pi.registerTool({
    name: 'update_plan',
    label: 'Update Plan',
    description: `Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.
`,
    parameters: updatePlanSchema,
    execute(_toolCallId, params: UpdatePlanArgs) {
      const validationError = validatePlan(params.plan)
      if (validationError)
        return Promise.resolve(textResult(validationError, true))

      currentPlan = params.plan.map((item) => ({
        step: item.step,
        status: item.status,
      }))
      updateWidget()
      return Promise.resolve(textResult('Plan updated'))
    },
  })
}
