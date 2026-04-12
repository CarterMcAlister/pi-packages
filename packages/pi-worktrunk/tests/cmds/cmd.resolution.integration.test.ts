import { describe, expect, it, mock } from 'bun:test'

import { cmdCd } from '../../src/cmds/cmdCd.ts'
import type { WorktrunkListEntry } from '../../src/services/worktrunk.ts'
import type { CommandDeps } from '../../src/types.ts'

function createDeps(): CommandDeps {
  return {
    worktrunk: {
      ensureAvailable: mock(),
      run: mock(),
      list: mock(async () => [
        {
          branch: 'feature/auth',
          path: '/repo.worktrees/feature-auth',
          kind: 'worktree',
          isCurrent: false,
          isMain: false,
        },
      ]),
      resolveRef: mock((entries: WorktrunkListEntry[], ref: string) =>
        entries.find(
          (entry) => entry.path?.endsWith(ref) || entry.branch === ref,
        ),
      ),
      getCurrent: mock(),
      create: mock(),
      switchTo: mock(),
      remove: mock(),
      showConfig: mock(),
    },
    statusService: {
      busy: mock(() => mock()),
      positive: mock(),
      critical: mock(),
    } as unknown as CommandDeps['statusService'],
  }
}

describe('cmdCd resolution integration', () => {
  it('prints the path for a matching basename-like ref', async () => {
    const notify = mock()
    await cmdCd(
      'feature-auth',
      { cwd: '/repo', hasUI: false, ui: { notify } } as never,
      createDeps(),
    )

    expect(notify).toHaveBeenCalledWith(
      'Worktree path: /repo.worktrees/feature-auth',
      'info',
    )
  })
})
