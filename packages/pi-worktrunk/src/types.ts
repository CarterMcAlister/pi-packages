import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import type { WorktrunkService } from './services/worktrunk.ts'
import type { StatusIndicator } from './ui/status.ts'

export interface WorktreeCreatedContext {
  path: string
  name: string
  branch: string
  project: string
  mainWorktree: string
}

export interface CommandDeps {
  worktrunk: WorktrunkService
  statusService: StatusIndicator
}

export type CmdHandler = (
  ...args: [_input: string, _ctx: ExtensionCommandContext, _deps: CommandDeps]
) => Promise<void>
