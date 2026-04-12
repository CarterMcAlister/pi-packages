const CREATE_USAGE = 'Usage: /worktree create <branch>'
const REMOVED_FLAG_MESSAGE =
  'This command now uses Worktrunk and no longer supports --generate or --name. Use `/worktree create <branch>` and configure Worktrunk worktree-path templates instead.'

export interface CreateCommandBranchArgs {
  branch: string
}

export interface CreateCommandArgError {
  error: string
}

export type CreateCommandArgs = CreateCommandBranchArgs | CreateCommandArgError

export function slugifyBranch(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[\s/_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function parseCreateCommandArgs(args: string): CreateCommandArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return { error: CREATE_USAGE }
  }

  if (tokens.includes('--generate') || tokens.includes('--name')) {
    return { error: REMOVED_FLAG_MESSAGE }
  }

  if (tokens.length !== 1 || tokens[0]?.startsWith('--')) {
    return { error: CREATE_USAGE }
  }

  return {
    branch: tokens[0],
  }
}
