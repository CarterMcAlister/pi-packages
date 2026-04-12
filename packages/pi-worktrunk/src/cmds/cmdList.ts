import type { WorktrunkListEntry } from '../services/worktrunk.ts';
import type { CmdHandler } from '../types.ts';

function formatListLabel(worktree: WorktrunkListEntry): string {
  const markers = [
    worktree.isMain ? '[main]' : '',
    worktree.isCurrent ? '[current]' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const branch = worktree.branch ?? '(detached)';
  const path = worktree.path ?? '(no path)';

  return `${branch}${markers ? ` ${markers}` : ''}\n  ${path}`;
}

export const cmdList: CmdHandler = async (_args, ctx, deps) => {
  deps.worktrunk.ensureAvailable(ctx.cwd);

  let worktrees: WorktrunkListEntry[];
  try {
    worktrees = await deps.worktrunk.list(ctx.cwd);
  } catch (error) {
    ctx.ui.notify(
      `Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return;
  }

  if (worktrees.length === 0) {
    ctx.ui.notify('No worktrees found', 'info');
    return;
  }

  if (!ctx.hasUI) {
    ctx.ui.notify(worktrees.map(formatListLabel).join('\n\n'), 'info');
    return;
  }

  const candidates = worktrees.filter((worktree) =>
    Boolean(worktree.branch && worktree.path),
  );
  if (candidates.length === 0) {
    ctx.ui.notify('No switchable worktrees found', 'info');
    return;
  }

  const options = candidates.map(formatListLabel);
  const byOption = new Map(
    options.map((option, index) => [option, candidates[index]]),
  );
  const selected = await ctx.ui.select('Select worktree to switch to', options);

  if (selected === undefined) {
    ctx.ui.notify('Cancelled', 'info');
    return;
  }

  const target = byOption.get(selected);
  if (!target?.branch) {
    ctx.ui.notify('Could not resolve selected worktree', 'error');
    return;
  }

  const stopBusy = deps.statusService.busy(
    ctx,
    `Switching to ${target.branch} via Worktrunk...`,
  );

  try {
    const switched = await deps.worktrunk.switchTo(ctx.cwd, target.branch);
    stopBusy();
    deps.statusService.positive(ctx, `Switched: ${switched.branch}`);
    ctx.ui.notify(`Worktree path: ${switched.path}`, 'info');
  } catch (error) {
    stopBusy();
    deps.statusService.critical(ctx, 'Failed to switch worktree');
    ctx.ui.notify(
      `Failed to switch worktree: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
};
