import { describe, expect, it, mock } from 'bun:test';

import { cmdList } from '../../src/cmds/cmdList.ts';
import type { CommandDeps } from '../../src/types.ts';

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
          isCurrent: true,
          isMain: false,
        },
      ]),
      resolveRef: mock(),
      getCurrent: mock(),
      create: mock(),
      switchTo: mock(async () => ({
        branch: 'feature/auth',
        path: '/repo.worktrees/feature-auth',
      })),
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

describe('cmdList switch integration', () => {
  it('switches using Worktrunk after interactive selection', async () => {
    const deps = createDeps();
    const notify = mock();
    const select = mock(
      async () => 'feature/auth [current]\n  /repo.worktrees/feature-auth',
    );

    await cmdList(
      '',
      { cwd: '/repo', hasUI: true, ui: { notify, select } } as never,
      deps,
    );

    expect(deps.worktrunk.switchTo).toHaveBeenCalledWith(
      '/repo',
      'feature/auth',
    );
  });
});
