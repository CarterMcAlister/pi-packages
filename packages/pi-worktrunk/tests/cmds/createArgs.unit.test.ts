import { describe, expect, it } from 'bun:test'

import {
  parseCreateCommandArgs,
  slugifyBranch,
} from '../../src/cmds/createArgs.ts'

describe('createArgs', () => {
  describe('slugifyBranch', () => {
    it('slugifies branch names deterministically', () => {
      expect(slugifyBranch('feature/login')).toBe('feature-login')
      expect(slugifyBranch('bugfix/JIRA-123/fix_npe')).toBe(
        'bugfix-jira-123-fix-npe',
      )
      expect(slugifyBranch('release/2026.04')).toBe('release-2026-04')
    })

    it('returns empty string when nothing remains after normalization', () => {
      expect(slugifyBranch('///___...')).toBe('')
    })
  })

  describe('parseCreateCommandArgs', () => {
    it('parses branch-first input', () => {
      expect(parseCreateCommandArgs('feature/login')).toEqual({
        branch: 'feature/login',
      })
    })

    it('rejects removed --name support', () => {
      expect(parseCreateCommandArgs('feature/login --name login-ui')).toEqual({
        error:
          'This command now uses Worktrunk and no longer supports --generate or --name. Use `/worktree create <branch>` and configure Worktrunk worktree-path templates instead.',
      })
    })

    it('rejects removed --generate support', () => {
      expect(parseCreateCommandArgs('--generate auth-refactor')).toEqual({
        error:
          'This command now uses Worktrunk and no longer supports --generate or --name. Use `/worktree create <branch>` and configure Worktrunk worktree-path templates instead.',
      })
    })

    it('rejects missing branch input', () => {
      expect(parseCreateCommandArgs('')).toEqual({
        error: 'Usage: /worktree create <branch>',
      })
    })
  })
})
