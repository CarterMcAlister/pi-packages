import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';
import type { WorktrunkListEntry } from '../services/worktrunk.ts';
import type { CommandDeps } from '../types.ts';

function formatRemoveOption(worktree: WorktrunkListEntry): string {
  const branch = worktree.branch ?? '(detached)';
  const path = worktree.path ?? '(no path)';
  return `${branch}\n  ${path}`;
}

function getRemovalRef(worktree: WorktrunkListEntry): string | undefined {
  return worktree.branch ?? worktree.path;
}

export async function cmdRemove(
  args: string,
  ctx: ExtensionCommandContext,
  deps: CommandDeps,
): Promise<void> {
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

  const ref = args.trim();
  let target: WorktrunkListEntry | undefined;

  if (!ref) {
    if (!ctx.hasUI) {
      ctx.ui.notify('Usage: /worktree remove <branch-or-path>', 'error');
      return;
    }

    const candidates = worktrees.filter(
      (worktree) =>
        !worktree.isMain && !worktree.isCurrent && getRemovalRef(worktree),
    );
    if (candidates.length === 0) {
      ctx.ui.notify('No removable worktrees found', 'info');
      return;
    }

    const options = candidates.map(formatRemoveOption);
    const byOption = new Map(
      options.map((option, index) => [option, candidates[index]]),
    );
    const selected = await ctx.ui.select('Select worktree to remove', options);

    if (selected === undefined) {
      ctx.ui.notify('Cancelled', 'info');
      return;
    }

    target = byOption.get(selected);
  } else {
    target = deps.worktrunk.resolveRef(worktrees, ref);
  }

  if (!target) {
    ctx.ui.notify(`Worktree not found: ${ref}`, 'error');
    return;
  }

  if (target.isMain) {
    ctx.ui.notify('Cannot remove the main worktree', 'error');
    return;
  }

  if (target.isCurrent) {
    ctx.ui.notify(
      'Cannot remove the current worktree. Switch to another first.',
      'error',
    );
    return;
  }

  const removalRef = getRemovalRef(target);
  if (!removalRef) {
    ctx.ui.notify(
      'Selected worktree cannot be removed because it has neither branch nor path',
      'error',
    );
    return;
  }

  if (ctx.hasUI) {
    const confirmed = await ctx.ui.confirm(
      'Remove worktree?',
      `This will remove:\n  Branch: ${target.branch ?? '(detached)'}\n  Path: ${target.path ?? '(no path)'}`,
    );

    if (!confirmed) {
      ctx.ui.notify('Cancelled', 'info');
      return;
    }
  }

  const stopBusy = deps.statusService.busy(
    ctx,
    `Removing ${removalRef} via Worktrunk...`,
  );

  try {
    await deps.worktrunk.remove(ctx.cwd, removalRef);
    stopBusy();
    deps.statusService.positive(ctx, `Removed: ${removalRef}`);
    ctx.ui.notify(`✓ Worktree removed: ${removalRef}`, 'info');
  } catch (error) {
    stopBusy();
    deps.statusService.critical(ctx, 'Failed to remove worktree');
    ctx.ui.notify(
      `Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}
