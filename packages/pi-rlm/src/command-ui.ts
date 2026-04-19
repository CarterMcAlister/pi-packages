import type { ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  DynamicBorder,
  type ExtensionCommandContext,
  getMarkdownTheme,
} from '@mariozechner/pi-coding-agent'
import { Container, Markdown, matchesKey, Text } from '@mariozechner/pi-tui'
import { summarizeRunningRuns } from './rlm-tool'

const WIDGET_KEY = 'pi-rlm-runs'
const STATUS_KEY = 'pi-rlm'

export async function showCommandOutput(
  ctx: ExtensionCommandContext,
  title: string,
  output: string,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(title, 'info')
    return
  }

  await ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container()
    const border = new DynamicBorder((value: string) =>
      theme.fg('accent', value),
    )
    const markdownTheme = getMarkdownTheme()

    container.addChild(border)
    container.addChild(new Text(theme.fg('accent', theme.bold(title)), 1, 0))
    container.addChild(new Markdown(output, 1, 1, markdownTheme))
    container.addChild(
      new Text(theme.fg('dim', 'Press Enter or Esc to close'), 1, 0),
    )
    container.addChild(border)

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, 'enter') || matchesKey(data, 'escape')) {
          done(undefined)
        }
      },
    }
  })
}

export function refreshRlmRunsWidget(ctx: ExtensionContext) {
  const records = summarizeRunningRuns()

  if (records.length === 0) {
    ctx.ui.setWidget(WIDGET_KEY, undefined)
    ctx.ui.setStatus(STATUS_KEY, undefined)
    return
  }

  ctx.ui.setWidget(
    WIDGET_KEY,
    [
      'RLM running jobs:',
      ...records.map(
        (record) =>
          `- ${record.id} ${shortText(record.task, 48)}${record.currentActivity ? ` — ${shortText(record.currentActivity, 42)}` : ''}`,
      ),
    ],
    { placement: 'belowEditor' },
  )
  ctx.ui.setStatus(STATUS_KEY, `${records.length} RLM run(s) active`)
}

function shortText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trimEnd()}…`
}
