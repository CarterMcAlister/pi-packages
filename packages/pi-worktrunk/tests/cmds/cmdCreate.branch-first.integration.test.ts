import { describe, expect, it, mock } from 'bun:test';

import { cmdCreate } from '../../src/cmds/cmdCreate.ts';
import type { CommandDeps } from '../../src/types.ts';

function createDeps(): CommandDeps {
  return {
    worktrunk: {
      ensureAvailable: mock(),
      run: mock(),
      list: mock(),
      resolveRef: mock(),
      getCurrent: mock(),
      create: mock(async (_cwd, branch) => ({
        branch,
        path: `/repo.worktrees/${branch.replace(/\//g, '-')}`,
      })),
      switchTo: mock(),
      remove: mock(),
      showConfig: mock(),
    },
    statusService: {
      busy: mock(() => mock()),
      positive: mock(),
      critical: mock(),
    } as unknown as CommandDeps['statusService'],
  };
}

describe('cmdCreate Worktrunk integration', () => {
  it('creates a branch-first worktree through Worktrunk', async () => {
    const deps = createDeps();
    const notify = mock();

    await cmdCreate(
      'feature/login',
      { cwd: '/repo', hasUI: false, ui: { notify } } as never,
      deps,
    );

    expect(deps.worktrunk.create).toHaveBeenCalledWith(
      '/repo',
      'feature/login',
    );
    expect(notify).toHaveBeenCalledWith(
      'Worktree ready: feature/login\n/repo.worktrees/feature-login',
      'info',
    );
  });

  it('rejects legacy unsupported flags', async () => {
    const deps = createDeps();
    const notify = mock();

    await cmdCreate(
      '--name login feature/login',
      { cwd: '/repo', hasUI: false, ui: { notify } } as never,
      deps,
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('no longer supports --generate or --name'),
      'error',
    );
  });
});
