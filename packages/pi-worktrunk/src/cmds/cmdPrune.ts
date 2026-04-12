import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';

export async function cmdPrune(
  _args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  ctx.ui.notify(
    '`/worktree prune` is deprecated in the Worktrunk-backed extension. Use Worktrunk-native cleanup flows like `wt remove` and `wt list` instead.',
    'warning',
  );
}
