import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { cmdCd } from '../../src/cmds/cmdCd.ts'
import { cmdCreate } from '../../src/cmds/cmdCreate.ts'
import { cmdList } from '../../src/cmds/cmdList.ts'
import { cmdRemove } from '../../src/cmds/cmdRemove.ts'
import { cmdStatus } from '../../src/cmds/cmdStatus.ts'
import type {
  WorktrunkListEntry,
  WorktrunkService,
} from '../../src/services/worktrunk.ts'
import type { CommandDeps } from '../../src/types.ts'

function createWorktrees(): WorktrunkListEntry[] {
  return [
    {
      branch: 'main',
      path: '/repo',
      kind: 'worktree',
      isCurrent: false,
      isMain: true,
      commit: { shortSha: 'aaaa1111', message: 'Main branch' },
      main: { ahead: 0, behind: 0 },
      remote: { ahead: 0, behind: 0 },
      workingTree: { modified: false, staged: false, untracked: false },
    },
    {
      branch: 'feature/auth',
      path: '/repo.worktrees/feature-auth',
      kind: 'worktree',
      isCurrent: true,
      isMain: false,
      symbols: '+',
      commit: { shortSha: 'bbbb2222', message: 'Add auth' },
      main: { ahead: 2, behind: 1 },
      remote: { ahead: 1, behind: 0 },
      workingTree: { modified: true, staged: true, untracked: false },
    },
  ]
}

function createDeps(worktrees = createWorktrees()): CommandDeps {
  const worktrunk: WorktrunkService = {
    ensureAvailable: mock(),
    run: mock(),
    list: mock(async () => worktrees),
    resolveRef: mock((entries: WorktrunkListEntry[], ref: string) =>
      entries.find((entry) => entry.branch === ref || entry.path === ref),
    ),
    getCurrent: mock(async () => worktrees.find((entry) => entry.isCurrent)),
    create: mock(async (_cwd, branch) => ({
      branch,
      path: `/repo.worktrees/${branch.replace(/\//g, '-')}`,
    })),
    switchTo: mock(async (_cwd, branch) => ({
      branch,
      path: `/repo.worktrees/${branch.replace(/\//g, '-')}`,
    })),
    remove: mock(async () => {}),
    showConfig: mock(async () => 'config'),
  }

  return {
    worktrunk,
    statusService: {
      busy: mock(() => mock()),
      positive: mock(),
      critical: mock(),
    } as unknown as CommandDeps['statusService'],
  }
}

describe('worktrunk-backed commands', () => {
  const notify = mock()
  const confirm = mock()
  const select = mock()

  beforeEach(() => {
    notify.mockReset()
    confirm.mockReset()
    select.mockReset()
  })

  it('creates via worktrunk and reports the path', async () => {
    const deps = createDeps()

    await cmdCreate(
      'feature/auth',
      { cwd: '/repo', hasUI: false, ui: { notify, confirm, select } } as never,
      deps,
    )

    expect(deps.worktrunk.create).toHaveBeenCalledWith('/repo', 'feature/auth')
    expect(notify).toHaveBeenCalledWith(
      'Worktree ready: feature/auth\n/repo.worktrees/feature-auth',
      'info',
    )
  })

  it('rejects removed create flags', async () => {
    const deps = createDeps()

    await cmdCreate(
      '--generate auth',
      { cwd: '/repo', hasUI: false, ui: { notify, confirm, select } } as never,
      deps,
    )

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('no longer supports --generate or --name'),
      'error',
    )
    expect(deps.worktrunk.create).not.toHaveBeenCalled()
  })

  it('lists worktrees in non-interactive mode', async () => {
    const deps = createDeps()

    await cmdList(
      '',
      { cwd: '/repo', hasUI: false, ui: { notify, confirm, select } } as never,
      deps,
    )

    const text = notify.mock.calls
      .map(([message]) => String(message))
      .join('\n')
    expect(text).toContain('feature/auth')
    expect(text).toContain('/repo.worktrees/feature-auth')
  })

  it('switches to a selected worktree in interactive mode', async () => {
    const deps = createDeps()
    select.mockResolvedValue(
      'feature/auth [current]\n  /repo.worktrees/feature-auth',
    )

    await cmdList(
      '',
      { cwd: '/repo', hasUI: true, ui: { notify, confirm, select } } as never,
      deps,
    )

    expect(deps.worktrunk.switchTo).toHaveBeenCalledWith(
      '/repo',
      'feature/auth',
    )
    expect(notify).toHaveBeenCalledWith(
      'Worktree path: /repo.worktrees/feature-auth',
      'info',
    )
  })

  it('prints the resolved worktree path from cd', async () => {
    const deps = createDeps()
    const resolveRef = deps.worktrunk.resolveRef as ReturnType<typeof mock>
    resolveRef.mockReturnValue(createWorktrees()[1])

    await cmdCd(
      'feature/auth',
      { cwd: '/repo', hasUI: false, ui: { notify, confirm, select } } as never,
      deps,
    )

    expect(notify).toHaveBeenCalledWith(
      'Worktree path: /repo.worktrees/feature-auth',
      'info',
    )
  })

  it('removes a resolved worktree through Worktrunk', async () => {
    const deps = createDeps()
    const resolveRef = deps.worktrunk.resolveRef as ReturnType<typeof mock>
    resolveRef.mockReturnValue({ ...createWorktrees()[1], isCurrent: false })
    confirm.mockResolvedValue(true)

    await cmdRemove(
      'feature/auth',
      { cwd: '/repo', hasUI: true, ui: { notify, confirm, select } } as never,
      deps,
    )

    expect(deps.worktrunk.remove).toHaveBeenCalledWith('/repo', 'feature/auth')
    expect(notify).toHaveBeenCalledWith(
      '✓ Worktree removed: feature/auth',
      'info',
    )
  })

  it('blocks removing the current worktree directly', async () => {
    const deps = createDeps()
    const resolveRef = deps.worktrunk.resolveRef as ReturnType<typeof mock>
    resolveRef.mockReturnValue(createWorktrees()[1])

    await cmdRemove(
      'feature/auth',
      { cwd: '/repo', hasUI: true, ui: { notify, confirm, select } } as never,
      deps,
    )

    expect(deps.worktrunk.remove).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      'Cannot remove the current worktree. Switch to another first.',
      'error',
    )
  })

  it('renders current worktree status from Worktrunk data', async () => {
    const deps = createDeps()

    await cmdStatus(
      '',
      { cwd: '/repo', hasUI: false, ui: { notify, confirm, select } } as never,
      deps as never,
    )

    const text = notify.mock.calls
      .map(([message]) => String(message))
      .join('\n')
    expect(text).toContain('Branch: feature/auth')
    expect(text).toContain('Path: /repo.worktrees/feature-auth')
    expect(text).toContain('Main relation: ahead 2, behind 1')
  })
})
