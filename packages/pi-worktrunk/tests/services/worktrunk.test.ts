import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';

import {
  ensureWorktrunkAvailable,
  listWorktrees,
  resolveWorktreeRef,
  WorktrunkError,
  type WorktrunkListEntry,
} from '../../src/services/worktrunk.ts';

describe('worktrunk service', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('throws a helpful error when wt is missing', () => {
    spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 127,
      stdout: '',
      stderr: '',
    } as never);

    expect(() => ensureWorktrunkAvailable('/repo')).toThrow(WorktrunkError);
    expect(() => ensureWorktrunkAvailable('/repo')).toThrow(
      /Worktrunk \(wt\) is not installed/,
    );
  });

  it('parses wt list json output', async () => {
    spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: JSON.stringify([
        {
          branch: 'feature/auth',
          path: '/repo.worktrees/feature-auth',
          kind: 'worktree',
          is_current: true,
          is_main: false,
        },
        {
          branch: 'main',
          path: '/repo',
          kind: 'worktree',
          is_current: false,
          is_main: true,
        },
      ]),
      stderr: '',
    } as never);

    const worktrees = await listWorktrees('/repo');

    expect(worktrees).toEqual<WorktrunkListEntry[]>([
      {
        branch: 'feature/auth',
        path: '/repo.worktrees/feature-auth',
        kind: 'worktree',
        isCurrent: true,
        isMain: false,
      },
      {
        branch: 'main',
        path: '/repo',
        kind: 'worktree',
        isCurrent: false,
        isMain: true,
      },
    ]);
  });

  it('resolves a worktree by branch, basename, or full path', () => {
    const worktrees: WorktrunkListEntry[] = [
      {
        branch: 'feature/auth',
        path: '/repo.worktrees/feature-auth',
        kind: 'worktree',
        isCurrent: false,
        isMain: false,
      },
    ];

    expect(resolveWorktreeRef(worktrees, 'feature/auth')?.path).toBe(
      '/repo.worktrees/feature-auth',
    );
    expect(resolveWorktreeRef(worktrees, 'feature-auth')?.path).toBe(
      '/repo.worktrees/feature-auth',
    );
    expect(
      resolveWorktreeRef(worktrees, '/repo.worktrees/feature-auth')?.path,
    ).toBe('/repo.worktrees/feature-auth');
  });
});
