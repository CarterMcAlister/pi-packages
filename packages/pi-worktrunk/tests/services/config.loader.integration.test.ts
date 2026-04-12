import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';

import {
  ensureWorktrunkAvailable,
  showWorktrunkConfig,
  WorktrunkError,
} from '../../src/services/worktrunk.ts';

describe('worktrunk loader integration', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('returns config output from wt config show', async () => {
    spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'user config: ~/.config/worktrunk/config.toml',
      stderr: '',
    } as never);

    await expect(showWorktrunkConfig('/repo')).resolves.toBe(
      'user config: ~/.config/worktrunk/config.toml',
    );
  });

  it('throws a WorktrunkError when wt is unavailable', () => {
    spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 127,
      stdout: '',
      stderr: '',
    } as never);

    expect(() => ensureWorktrunkAvailable('/repo')).toThrow(WorktrunkError);
  });
});
