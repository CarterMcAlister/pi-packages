import { describe, expect, it, mock } from 'bun:test'

import { cmdRemove } from '../../src/cmds/cmdRemove.ts'
import type { WorktrunkListEntry } from '../../src/services/worktrunk.ts'
import type { CommandDeps } from '../../src/types.ts'

function createDeps(): CommandDeps {
  return {
    worktrunk: {
      ensureAvailable: mock(),
      run: mock(),
      list: mock(async () => [
        {
          branch: 'main',
          path: '/repo',
          kind: 'worktree',
          isCurrent: false,
          isMain: true,
        },
        {
          branch: 'feature/auth',
          path: '/repo.worktrees/feature-auth',
          kind: 'worktree',
          isCurrent: false,
          isMain: false,
        },
      ]),
      resolveRef: mock((entries: WorktrunkListEntry[], ref: string) =>
        entries.find((entry) => entry.branch === ref),
      ),
      getCurrent: mock(),
      create: mock(),
      switchTo: mock(),
      remove: mock(async () => {}),
      showConfig: mock(),
    },
    statusService: {
      busy: mock(() => mock()),
      positive: mock(),
      critical: mock(),
    } as unknown as CommandDeps['statusService'],
  }
}

describe('cmdRemove selection integration', () => {
  it('removes an interactively selected worktree via Worktrunk', async () => {
    const deps = createDeps()
    const notify = mock()
    const confirm = mock(async () => true)
    const select = mock(
      async () => 'feature/auth\n  /repo.worktrees/feature-auth',
    )

    await cmdRemove(
      '',
      { cwd: '/repo', hasUI: true, ui: { notify, confirm, select } } as never,
      deps,
    )

    expect(deps.worktrunk.remove).toHaveBeenCalledWith('/repo', 'feature/auth')
    expect(notify).toHaveBeenCalledWith(
      '✓ Worktree removed: feature/auth',
      'info',
    )
  })
})
