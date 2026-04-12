import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import type { CommandDeps } from '../types.ts'

function formatRelation(
  label: string,
  ahead?: number,
  behind?: number,
): string {
  return `${label}: ahead ${ahead ?? 0}, behind ${behind ?? 0}`
}

export async function cmdStatus(
  _args: string,
  ctx: ExtensionCommandContext,
  deps: CommandDeps,
): Promise<void> {
  deps.worktrunk.ensureAvailable(ctx.cwd)

  try {
    const current = await deps.worktrunk.getCurrent(ctx.cwd)
    if (!current) {
      ctx.ui.notify(
        'Current worktree not found in `wt list --format=json` output',
        'error',
      )
      return
    }

    const status = [
      `Branch: ${current.branch ?? '(detached)'}`,
      `Path: ${current.path ?? '(no path)'}`,
      `Kind: ${current.kind}`,
      `Main worktree: ${current.isMain ? 'Yes' : 'No'}`,
      formatRelation(
        'Main relation',
        current.main?.ahead,
        current.main?.behind,
      ),
      formatRelation(
        'Remote relation',
        current.remote?.ahead,
        current.remote?.behind,
      ),
      `Commit: ${current.commit?.shortSha ?? 'unknown'} ${current.commit?.message ?? ''}`.trim(),
      `Working tree: staged=${current.workingTree?.staged === true ? 'yes' : 'no'}, modified=${
        current.workingTree?.modified === true ? 'yes' : 'no'
      }, untracked=${current.workingTree?.untracked === true ? 'yes' : 'no'}`,
    ]

    ctx.ui.notify(status.join('\n'), 'info')
  } catch (error) {
    ctx.ui.notify(
      `Failed to load worktree status: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    )
  }
}
