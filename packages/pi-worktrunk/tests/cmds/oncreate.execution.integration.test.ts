import { describe, expect, it, mock } from 'bun:test';

import { cmdInit } from '../../src/cmds/cmdInit.ts';
import { cmdTemplates } from '../../src/cmds/cmdTemplates.ts';

describe('legacy onCreate replacement guidance', () => {
  it('points users to Worktrunk setup instead of extension-owned hooks', async () => {
    const notify = mock();

    await cmdInit('', { cwd: '/repo', hasUI: false, ui: { notify } } as never);

    const text = notify.mock.calls
      .map(([message]) => String(message))
      .join('\n');
    expect(text).toContain('wt config create');
    expect(text).toContain('~/.config/worktrunk/config.toml');
  });

  it('marks template preview as deprecated', async () => {
    const notify = mock();

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
