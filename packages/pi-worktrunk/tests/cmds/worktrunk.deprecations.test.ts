import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { cmdInit } from '../../src/cmds/cmdInit.ts';
import { cmdPrune } from '../../src/cmds/cmdPrune.ts';
import { cmdSettings } from '../../src/cmds/cmdSettings.ts';
import { cmdTemplates } from '../../src/cmds/cmdTemplates.ts';
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

describe('worktrunk deprecations and setup commands', () => {
  const notify = mock();

  beforeEach(() => {
    notify.mockReset();
  });

  it('shows Worktrunk setup guidance in init', async () => {
    await cmdInit('', { cwd: '/repo', hasUI: false, ui: { notify } } as never);

    const text = notify.mock.calls
      .map(([message]) => String(message))
      .join('\n');
    expect(text).toContain('wt config create');
    expect(text).toContain('wt config create --project');
    expect(text).toContain('wt config shell install');
  });

  it('shows Worktrunk config output in settings', async () => {
    const deps = createDeps();

    await cmdSettings(
      '',
      { cwd: '/repo', hasUI: false, ui: { notify } } as never,
      deps,
    );

    expect(deps.worktrunk.showConfig).toHaveBeenCalledWith('/repo');
    expect(notify).toHaveBeenCalledWith(
      'user config: ~/.config/worktrunk/config.toml',
      'info',
    );
  });

  it('rejects settings writes', async () => {
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

  it('marks prune as deprecated', async () => {
    await cmdPrune('', { cwd: '/repo', hasUI: false, ui: { notify } } as never);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('deprecated'),
      'warning',
    );
  });

  it('marks templates as deprecated', async () => {
    await cmdTemplates('', {
      cwd: '/repo',
      hasUI: false,
      ui: { notify },
    } as never);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('deprecated'),
      'warning',
    );
  });
});
