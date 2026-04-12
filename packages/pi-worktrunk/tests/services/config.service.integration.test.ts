import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as childProcess from 'node:child_process'

import {
  createWorktree,
  switchToWorktree,
} from '../../src/services/worktrunk.ts'

describe('worktrunk service integration', () => {
  beforeEach(() => {
    mock.restore()
  })

  it('creates a worktree and resolves its path from wt list', async () => {
    spyOn(childProcess, 'spawnSync')
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as never)
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify([
          {
            branch: 'feature/auth',
            path: '/repo.worktrees/feature-auth',
            kind: 'worktree',
            is_current: false,
            is_main: false,
          },
        ]),
        stderr: '',
      } as never)

    await expect(createWorktree('/repo', 'feature/auth')).resolves.toEqual({
      branch: 'feature/auth',
      path: '/repo.worktrees/feature-auth',
    })
  })

  it('switches to an existing worktree and resolves its path from wt list', async () => {
    spyOn(childProcess, 'spawnSync')
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' } as never)
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify([
          {
            branch: 'feature/auth',
            path: '/repo.worktrees/feature-auth',
            kind: 'worktree',
            is_current: true,
            is_main: false,
          },
        ]),
        stderr: '',
      } as never)

    await expect(switchToWorktree('/repo', 'feature/auth')).resolves.toEqual({
      branch: 'feature/auth',
      path: '/repo.worktrees/feature-auth',
    })
  })
})
