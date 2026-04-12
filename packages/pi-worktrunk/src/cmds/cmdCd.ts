import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';
import type { WorktrunkListEntry } from '../services/worktrunk.ts';
import type { CommandDeps } from '../types.ts';

export async function cmdCd(
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
  if (!ref) {
    const main = worktrees.find((worktree) => worktree.isMain);
    if (main?.path) {
      ctx.ui.notify(`Main worktree: ${main.path}`, 'info');
      return;
    }

    ctx.ui.notify('Main worktree not found', 'error');
    return;
  }

  const target = deps.worktrunk.resolveRef(worktrees, ref);
  if (!target?.path) {
    ctx.ui.notify(`Worktree not found: ${ref}`, 'error');
    return;
  }

  ctx.ui.notify(`Worktree path: ${target.path}`, 'info');
}
