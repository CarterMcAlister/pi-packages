import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { type Component, truncateToWidth } from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'

const WIDGET_KEY = 'pi-codex-tasks'
const SPINNER = ['✳', '✴', '✵', '✶', '✷', '✸', '✹', '✺', '✻', '✼', '✽']
const MAX_VISIBLE_TASKS = 10
const WIDGET_ANIMATION_MS = 150

type StepStatus = 'pending' | 'in_progress' | 'completed'
type Theme = ExtensionContext['ui']['theme']
type PlanUi = ExtensionContext['ui']
type WidgetTui = { terminal?: { columns?: number } }

interface PlanItem {
  step: string
  status: StepStatus
}

interface TaskMetrics {
  startedAt: number
  inputTokens: number
  outputTokens: number
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

function validatePlan(plan: PlanItem[]): string | undefined {
  const inProgressCount = plan.filter(
    (item) => item.status === 'in_progress',
  ).length
  if (inProgressCount > 1) {
    return 'At most one plan step can be in_progress at a time.'
  }
  return undefined
}

function planItemKey(item: PlanItem, index: number): string {
  return `${index + 1}:${item.step}`
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`

  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`

  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

function strikethrough(text: string): string {
  return `\x1b[9m${text}\x1b[29m`
}

function displayStep(step: string): string {
  return step.replace(/\s+/g, ' ').trim() || '(empty step)'
}

function plainStatusIcon(status: StepStatus): string {
  if (status === 'completed') return '✔'
  if (status === 'in_progress') return '◼'
  return '◻'
}

function statusIcon(
  status: StepStatus,
  theme: Theme,
  active: boolean,
  spinnerFrame: number,
): string {
  if (active) {
    const spinner = SPINNER[spinnerFrame % SPINNER.length] ?? '✳'
    return theme.fg('accent', spinner)
  }
  if (status === 'completed') return theme.fg('success', '✔')
  if (status === 'in_progress') return theme.fg('accent', '◼')
  return '◻'
}

function renderStatusSummary(plan: PlanItem[]): string {
  const completed = plan.filter((item) => item.status === 'completed').length
  const inProgress = plan.filter((item) => item.status === 'in_progress').length
  const pending = plan.filter((item) => item.status === 'pending').length

  const parts: string[] = []
  if (completed > 0) parts.push(`${completed} done`)
  if (inProgress > 0) parts.push(`${inProgress} in progress`)
  if (pending > 0) parts.push(`${pending} open`)

  return `${plan.length} tasks (${parts.join(', ')})`
}

function renderPlanLines(
  plan: PlanItem[],
  metrics: ReadonlyMap<string, TaskMetrics>,
  spinnerFrame: number,
  theme: Theme,
  width: number,
): string[] {
  if (plan.length === 0) return []

  const lines = [
    truncateToWidth(
      `${theme.fg('accent', '●')} ${theme.fg('accent', renderStatusSummary(plan))}`,
      width,
    ),
  ]

  for (const [index, item] of plan.slice(0, MAX_VISIBLE_TASKS).entries()) {
    const key = planItemKey(item, index)
    const active = item.status === 'in_progress'
    const icon = statusIcon(item.status, theme, active, spinnerFrame)
    const itemId = theme.fg('dim', `#${index + 1}`)

    let text: string
    if (active) {
      const metric = metrics.get(key)
      let stats = ''
      if (metric) {
        const elapsed = formatDuration(Date.now() - metric.startedAt)
        const tokenParts: string[] = []
        if (metric.inputTokens > 0) {
          tokenParts.push(`↑ ${formatTokens(metric.inputTokens)}`)
        }
        if (metric.outputTokens > 0) {
          tokenParts.push(`↓ ${formatTokens(metric.outputTokens)}`)
        }
        stats =
          tokenParts.length > 0
            ? ` ${theme.fg('dim', `(${elapsed} · ${tokenParts.join(' ')})`)}`
            : ` ${theme.fg('dim', `(${elapsed})`)}`
      }
      text = `  ${icon} ${itemId} ${theme.fg('accent', `${displayStep(item.step)}…`)}${stats}`
    } else if (item.status === 'completed') {
      text = `  ${icon} ${theme.fg('dim', strikethrough(`#${index + 1} ${displayStep(item.step)}`))}`
    } else {
      text = `  ${icon} ${itemId} ${displayStep(item.step)}`
    }

    lines.push(truncateToWidth(text, width))
  }

  if (plan.length > MAX_VISIBLE_TASKS) {
    lines.push(
      truncateToWidth(
        theme.fg('dim', `    … and ${plan.length - MAX_VISIBLE_TASKS} more`),
        width,
      ),
    )
  }

  return lines
}

function buildWidgetComponent(
  plan: PlanItem[],
  metrics: ReadonlyMap<string, TaskMetrics>,
  spinnerFrame: number,
): (tui: WidgetTui, theme: Theme) => Component {
  const planSnapshot = plan.map((item) => ({ ...item }))
  const metricsSnapshot = new Map(
    [...metrics].map(([key, metric]) => [key, { ...metric }]),
  )

  return (tui, theme) => ({
    render(width: number): string[] {
      const renderWidth = Math.min(width, tui.terminal?.columns ?? width)
      return renderPlanLines(
        planSnapshot,
        metricsSnapshot,
        spinnerFrame,
        theme,
        renderWidth,
      )
    },
    invalidate() {},
  })
}

export default function registerCodexTasks(pi: ExtensionAPI): void {
  let latestUi: PlanUi | undefined
  let currentPlan: PlanItem[] = []
  let spinnerFrame = 0
  let widgetTimer: ReturnType<typeof setInterval> | undefined
  const metrics = new Map<string, TaskMetrics>()

  function hasActiveStep(): boolean {
    return currentPlan.some((item) => item.status === 'in_progress')
  }

  function syncMetrics(): void {
    const activeKeys = new Set<string>()

    currentPlan.forEach((item, index) => {
      const key = planItemKey(item, index)
      if (item.status === 'in_progress') {
        activeKeys.add(key)
        if (!metrics.has(key)) {
          metrics.set(key, {
            startedAt: Date.now(),
            inputTokens: 0,
            outputTokens: 0,
          })
        }
      }
    })

    for (const key of metrics.keys()) {
      if (!activeKeys.has(key)) metrics.delete(key)
    }
  }

  function stopWidgetAnimation(): void {
    if (!widgetTimer) return
    clearInterval(widgetTimer)
    widgetTimer = undefined
  }

  function updateWidget(): void {
    if (!latestUi) return

    syncMetrics()

    if (currentPlan.length === 0) {
      latestUi.setWidget(WIDGET_KEY, undefined)
      stopWidgetAnimation()
      return
    }

    latestUi.setWidget(
      WIDGET_KEY,
      buildWidgetComponent(currentPlan, metrics, spinnerFrame),
      { placement: 'aboveEditor' },
    )

    if (hasActiveStep()) ensureWidgetAnimation()
    else stopWidgetAnimation()
  }

  function ensureWidgetAnimation(): void {
    if (widgetTimer) return
    widgetTimer = setInterval(() => {
      if (!hasActiveStep()) {
        stopWidgetAnimation()
        return
      }
      spinnerFrame++
      updateWidget()
    }, WIDGET_ANIMATION_MS)
    widgetTimer.unref?.()
  }

  function rememberUi(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return
    latestUi = ctx.ui
    updateWidget()
  }

  pi.on('before_agent_start', async (_event, ctx) => rememberUi(ctx))
  pi.on('tool_execution_start', async (_event, ctx) => rememberUi(ctx))
  pi.on('turn_end', async (event) => {
    const usage = (
      event.message as { usage?: { input?: number; output?: number } }
    )?.usage
    if (!usage) return

    for (const [index, item] of currentPlan.entries()) {
      if (item.status !== 'in_progress') continue
      const key = planItemKey(item, index)
      const metric = metrics.get(key)
      if (!metric) continue
      metric.inputTokens += usage.input ?? 0
      metric.outputTokens += usage.output ?? 0
    }

    updateWidget()
  })
  pi.on('session_switch' as never, async (_event, ctx) => {
    currentPlan = []
    metrics.clear()
    spinnerFrame = 0
    rememberUi(ctx)
  })
  pi.on('session_shutdown', async () => {
    currentPlan = []
    metrics.clear()
    spinnerFrame = 0
    latestUi?.setWidget(WIDGET_KEY, undefined)
    latestUi = undefined
    stopWidgetAnimation()
  })

  pi.registerCommand('tasks', {
    description: 'Manage the current Codex plan',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      latestUi = ctx.ui
      const ui = ctx.ui

      const setPlan = (plan: PlanItem[]): void => {
        currentPlan = plan.map((item) => ({ ...item }))
        updateWidget()
      }

      const mainMenu = async (): Promise<void> => {
        const taskCount = currentPlan.length
        const completedCount = currentPlan.filter(
          (item) => item.status === 'completed',
        ).length
        const choices = [`View all tasks (${taskCount})`, 'Create task']
        if (completedCount > 0)
          choices.push(`Clear completed (${completedCount})`)
        if (taskCount > 0) choices.push(`Clear all (${taskCount})`)

        const choice = await ui.select('Codex Plan', choices)
        if (!choice) return

        if (choice.startsWith('View')) return viewTasks()
        if (choice === 'Create task') return createTask()
        if (choice.startsWith('Clear completed')) {
          setPlan(currentPlan.filter((item) => item.status !== 'completed'))
          return mainMenu()
        }
        if (choice.startsWith('Clear all')) {
          setPlan([])
          return mainMenu()
        }
      }

      const viewTasks = async (): Promise<void> => {
        if (currentPlan.length === 0) {
          await ui.select('No plan steps', ['← Back'])
          return mainMenu()
        }

        const choices = currentPlan.map(
          (item, index) =>
            `${plainStatusIcon(item.status)} #${index + 1} [${item.status}] ${displayStep(item.step)}`,
        )
        choices.push('← Back')

        const selected = await ui.select('Codex Plan', choices)
        if (!selected || selected === '← Back') return mainMenu()

        const match = selected.match(/#(\d+)/)
        if (!match) return viewTasks()
        return viewTaskDetail(Number(match[1]) - 1)
      }

      const viewTaskDetail = async (index: number): Promise<void> => {
        const item = currentPlan[index]
        if (!item) return viewTasks()

        const actions: string[] = []
        if (item.status !== 'in_progress') actions.push('▸ Start (in_progress)')
        if (item.status !== 'completed') actions.push('✓ Complete')
        actions.push('✗ Delete')
        actions.push('← Back')

        const action = await ui.select(
          `#${index + 1} [${item.status}] ${displayStep(item.step)}`,
          actions,
        )

        if (action === '▸ Start (in_progress)') {
          setPlan(
            currentPlan.map((planItem, planIndex) => ({
              ...planItem,
              status:
                planIndex === index
                  ? 'in_progress'
                  : planItem.status === 'in_progress'
                    ? 'pending'
                    : planItem.status,
            })),
          )
          return viewTasks()
        }
        if (action === '✓ Complete') {
          setPlan(
            currentPlan.map((planItem, planIndex) =>
              planIndex === index
                ? { ...planItem, status: 'completed' }
                : planItem,
            ),
          )
          return viewTasks()
        }
        if (action === '✗ Delete') {
          setPlan([
            ...currentPlan.slice(0, index),
            ...currentPlan.slice(index + 1),
          ])
          return viewTasks()
        }
        return viewTasks()
      }

      const createTask = async (): Promise<void> => {
        const step = (await ui.input('Plan step'))?.trim()
        if (!step) return mainMenu()
        setPlan([...currentPlan, { step, status: 'pending' }])
        return mainMenu()
      }

      await mainMenu()
    },
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
