import { expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDefaultSkillpackRoot } from '../src/constants'
import { normalizeSkillpackPath, resolveSkillpackDirectory } from '../src/paths'

test('normalizeSkillpackPath accepts a group path', () => {
  expect(normalizeSkillpackPath('superpowers')).toBe('superpowers')
})

test('normalizeSkillpackPath normalizes separators and trimming', () => {
  expect(normalizeSkillpackPath(' ./superpowers\\agent-browser/ ')).toBe(
    'superpowers/agent-browser',
  )
})

test('normalizeSkillpackPath rejects empty input', () => {
  expect(() => normalizeSkillpackPath('   ')).toThrow('required')
})

test('normalizeSkillpackPath rejects absolute unix paths', () => {
  expect(() => normalizeSkillpackPath('/tmp/superpowers')).toThrow('relative')
})

test('normalizeSkillpackPath rejects windows drive paths', () => {
  expect(() => normalizeSkillpackPath('C:/packs/superpowers')).toThrow(
    'relative',
  )
})

test('normalizeSkillpackPath rejects parent traversal', () => {
  expect(() => normalizeSkillpackPath('../escape')).toThrow('..')
})

test('resolveSkillpackDirectory resolves a logical path under the root', () => {
  const rootDir = '/tmp/skillpacks'

  expect(
    resolveSkillpackDirectory(rootDir, 'superpowers/agent-browser'),
  ).toEqual({
    logicalPath: 'superpowers/agent-browser',
    absolutePath: join(rootDir, 'superpowers', 'agent-browser'),
  })
})

test('getDefaultSkillpackRoot points at ~/.pi/agent/skillpacks', () => {
  expect(getDefaultSkillpackRoot()).toBe(
    join(homedir(), '.pi', 'agent', 'skillpacks'),
  )
})
