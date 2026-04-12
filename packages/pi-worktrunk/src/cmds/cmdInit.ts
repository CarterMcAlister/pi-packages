import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';

const SETUP_GUIDE = [
  'Worktrunk setup',
  '━━━━━━━━━━━━━━━',
  '',
  'This extension now uses Worktrunk (`wt`) instead of managing git worktrees directly.',
  '',
  'Recommended setup:',
  '  1. Install Worktrunk',
  '     brew install worktrunk',
  '  2. Install shell integration',
  '     wt config shell install',
  '  3. Create user config',
  '     wt config create',
  '  4. Create project config (optional, shared)',
  '     wt config create --project',
  '',
  'Config files used by Worktrunk:',
  '  - ~/.config/worktrunk/config.toml',
  '  - .config/wt.toml',
  '',
  'Docs: https://worktrunk.dev/worktrunk/',
].join('\n');

export async function cmdInit(
  _args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  ctx.ui.notify(SETUP_GUIDE, 'info');
}
