import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import type { CommandDeps } from '../types.ts'
import { parseCreateCommandArgs } from './createArgs.ts'

export async function cmdCreate(
  args: string,
  ctx: ExtensionCommandContext,
  deps: CommandDeps,
): Promise<void> {
  const parsed = parseCreateCommandArgs(args)
  if ('error' in parsed) {
    ctx.ui.notify(parsed.error, 'error')
    return
  }

  deps.worktrunk.ensureAvailable(ctx.cwd)

  const branch = parsed.branch
  const stopBusy = deps.statusService.busy(
    ctx,
    `Creating worktree via Worktrunk: ${branch}...`,
  )

  try {
    const created = await deps.worktrunk.create(ctx.cwd, branch)
    stopBusy()
    deps.statusService.positive(ctx, `Created: ${created.branch}`)
    ctx.ui.notify(`Worktree ready: ${created.branch}\n${created.path}`, 'info')
  } catch (error) {
    stopBusy()
    deps.statusService.critical(ctx, 'Failed to create worktree')
    ctx.ui.notify(
      `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  }
}
