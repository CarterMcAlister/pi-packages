import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as childProcess from 'node:child_process'

import { listWorktrees, WorktrunkError } from '../../src/services/worktrunk.ts'

describe('worktrunk list parsing', () => {
  beforeEach(() => {
    mock.restore()
  })

  it('maps optional list fields from wt json output', async () => {
    spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        {
          branch: 'feature/auth',
          path: '/repo.worktrees/feature-auth',
          kind: 'worktree',
          is_current: true,
          is_main: false,
          symbols: '+',
          main_state: 'ahead',
          operation_state: 'merge',
          url: 'http://localhost:1234',
          url_active: true,
          commit: { short_sha: 'abcd1234', message: 'Add auth' },
          main: { ahead: 2, behind: 1 },
          remote: { ahead: 1, behind: 0 },
          working_tree: { staged: true, modified: true, untracked: false },
        },
      ]),
      stderr: '',
    } as never)

    const [entry] = await listWorktrees('/repo')

    expect(entry).toEqual({
      branch: 'feature/auth',
      path: '/repo.worktrees/feature-auth',
      kind: 'worktree',
      isCurrent: true,
      isMain: false,
      isPrevious: undefined,
      statusline: undefined,
      symbols: '+',
      mainState: 'ahead',
      operationState: 'merge',
      url: 'http://localhost:1234',
      urlActive: true,
      commit: { shortSha: 'abcd1234', message: 'Add auth' },
      main: { ahead: 2, behind: 1 },
      remote: { ahead: 1, behind: 0 },
      workingTree: {
        staged: true,
        modified: true,
        untracked: false,
        renamed: undefined,
        deleted: undefined,
      },
    })
  })

  it('throws when wt list json is invalid', async () => {
    spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: '{not json}',
      stderr: '',
    } as never)

    await expect(listWorktrees('/repo')).rejects.toThrow(WorktrunkError)
  })
})
