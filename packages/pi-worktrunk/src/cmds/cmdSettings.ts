import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';
import type { CommandDeps } from '../types.ts';

const READ_ONLY_MESSAGE =
  'Settings are now read-only in this extension. Configure Worktrunk via `wt config create`, `wt config create --project`, or by editing Worktrunk TOML files directly.';

export async function cmdSettings(
  args: string,
  ctx: ExtensionCommandContext,
  deps: CommandDeps,
): Promise<void> {
  if (args.trim()) {
    ctx.ui.notify(READ_ONLY_MESSAGE, 'error');
    return;
  }

  deps.worktrunk.ensureAvailable(ctx.cwd);

  try {
    const output = await deps.worktrunk.showConfig(ctx.cwd);
    ctx.ui.notify(output || 'No Worktrunk config output available.', 'info');
  } catch (error) {
    ctx.ui.notify(
      `Failed to show Worktrunk config: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}
