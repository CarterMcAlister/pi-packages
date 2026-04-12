/**
 * Worktree Extension - Worktrunk-backed worktree management for Pi
 *
 */

import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import { cmdCd } from './cmds/cmdCd.ts';
import { cmdCreate } from './cmds/cmdCreate.ts';
import { cmdInit } from './cmds/cmdInit.ts';
import { cmdList } from './cmds/cmdList.ts';
import { cmdPrune } from './cmds/cmdPrune.ts';
import { cmdRemove } from './cmds/cmdRemove.ts';
import { cmdSettings } from './cmds/cmdSettings.ts';
import { cmdStatus } from './cmds/cmdStatus.ts';
import { cmdTemplates } from './cmds/cmdTemplates.ts';
import { createCompletionFactory } from './services/completions.ts';
import { createWorktrunkService } from './services/worktrunk.ts';
import type { CmdHandler } from './types.ts';
import { StatusIndicator } from './ui/status.ts';

const HELP_TEXT = `
/worktree - Worktrunk-backed worktree management

Commands:
  /worktree init                   Show Worktrunk setup guidance
  /worktree settings               Show Worktrunk config info (read-only)
  /worktree create <branch>        Create a new worktree via 'wt switch --create'
  /worktree list                   List worktrees and optionally switch via Worktrunk
  /worktree remove <name>          Remove a worktree via Worktrunk
  /worktree status                 Show current worktree info from Worktrunk
  /worktree cd <name>              Print path to worktree
  /worktree prune                  Deprecated; use Worktrunk-native cleanup flows
  /worktree templates              Deprecated; see Worktrunk template docs

Configuration:
  Worktrunk config is now the source of truth:
    - ~/.config/worktrunk/config.toml
    - .config/wt.toml

Setup:
  Install Worktrunk and enable shell integration:
    brew install worktrunk
    wt config shell install

Removed extension-only features:
  - /worktree create --generate
  - /worktree create --name
  - extension-managed hooks/config matching
`.trim();

const commands: Record<string, CmdHandler> = {
  init: cmdInit,
  settings: cmdSettings,
  config: cmdSettings,
  create: cmdCreate,
  list: cmdList,
  ls: cmdList,
  remove: cmdRemove,
  rm: cmdRemove,
  status: cmdStatus,
  cd: cmdCd,
  prune: cmdPrune,
  templates: cmdTemplates,
  vars: cmdTemplates,
  tokens: cmdTemplates,
};

const PiWorktreeExtension: ExtensionFactory = async (pi) => {
  const worktrunk = createWorktrunkService();
  const statusService = new StatusIndicator('pi-worktree');
  const getSubcommandCompletions = createCompletionFactory(commands);

  pi.registerCommand('worktree', {
    description: 'Worktrunk-backed worktree management for isolated workspaces',
    getArgumentCompletions(argumentPrefix) {
      return getSubcommandCompletions(argumentPrefix);
    },
    handler: async (args, ctx) => {
      const [cmd, ...rest] = args.trim().split(/\s+/);
      const command = commands[cmd];

      if (!command) {
        ctx.ui.notify(HELP_TEXT, 'info');
        return;
      }

      try {
        await command(rest.join(' '), ctx, {
          worktrunk,
          statusService,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Worktree command failed: ${message}`, 'error');
      }
    },
  });
};

export default PiWorktreeExtension;
