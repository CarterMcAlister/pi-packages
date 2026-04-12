import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';

export async function cmdTemplates(
  _args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  ctx.ui.notify(
    '`/worktree templates` is deprecated in the Worktrunk-backed extension. Use Worktrunk template variables in `~/.config/worktrunk/config.toml` or `.config/wt.toml`, and see https://worktrunk.dev/config/ and https://worktrunk.dev/hook/.',
    'warning',
  );
}
