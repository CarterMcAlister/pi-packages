import { describe, expect, it } from 'bun:test';

import {
  resolveWorktreeRef,
  type WorktrunkListEntry,
} from '../../src/services/worktrunk.ts';

describe('worktrunk matcher', () => {
  const worktrees: WorktrunkListEntry[] = [
    {
      branch: 'feature/auth',
      path: '/repo.worktrees/feature-auth',
      kind: 'worktree',
      isCurrent: false,
      isMain: false,
    },
  ];

  it('matches by branch', () => {
    expect(resolveWorktreeRef(worktrees, 'feature/auth')?.path).toBe(
      '/repo.worktrees/feature-auth',
    );
  });

  it('matches by basename', () => {
    expect(resolveWorktreeRef(worktrees, 'feature-auth')?.path).toBe(
      '/repo.worktrees/feature-auth',
    );
  });

  it('matches by full path', () => {
    expect(
      resolveWorktreeRef(worktrees, '/repo.worktrees/feature-auth')?.path,
    ).toBe('/repo.worktrees/feature-auth');
  });
});
