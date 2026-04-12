import { describe, expect, it, mock } from 'bun:test'

import { cmdCreate } from '../../src/cmds/cmdCreate.ts'
import type { CommandDeps } from '../../src/types.ts'

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
      showConfig: mock(),
    },
    statusService: {
      busy: mock(() => mock()),
      positive: mock(),
      critical: mock(),
    } as unknown as CommandDeps['statusService'],
  }
}

describe('branchNameGenerator retirement', () => {
  it('rejects --generate because Worktrunk is now the source of truth', async () => {
    const notify = mock()

    await cmdCreate(
      '--generate feature-auth',
      { cwd: '/repo', hasUI: false, ui: { notify } } as never,
      createDeps(),
    )

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('no longer supports --generate or --name'),
      'error',
    )
  })
})
