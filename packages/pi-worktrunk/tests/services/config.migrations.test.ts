import { describe, expect, it, mock } from 'bun:test';

import { cmdSettings } from '../../src/cmds/cmdSettings.ts';
import type { CommandDeps } from '../../src/types.ts';

function createDeps(): CommandDeps {
  return {
    worktrunk: {
      ensureAvailable: mock(),
      run: mock(),
      list: mock(),
      resolveRef: mock(),
      getCurrent: mock(),
      create: mock(),
      switchTo: mock(),
      remove: mock(),
      showConfig: mock(
        async () => 'user config: ~/.config/worktrunk/config.toml',
      ),
    },
    statusService: {
      busy: mock(() => mock()),
      positive: mock(),
      critical: mock(),
    } as unknown as CommandDeps['statusService'],
  };
}

describe('legacy config migration behavior', () => {
  it('rejects extension-managed settings writes in favor of Worktrunk config', async () => {
    const notify = mock();

    await cmdSettings(
      'worktreeRoot ~/.worktrees',
      { cwd: '/repo', hasUI: false, ui: { notify } } as never,
      createDeps(),
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('read-only'),
      'error',
    );
  });
});
