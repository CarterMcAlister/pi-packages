import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getAddCompletions, getRemoveCompletions } from '../src/completions'
import {
  createTempSkillpackRoot,
  removeTempDir,
  writeSkill,
} from './support/skillpack-fixtures'

let rootDir = ''

beforeEach(async () => {
  rootDir = await createTempSkillpackRoot()
  await writeSkill(rootDir, 'superpowers/agent-browser')
  await writeSkill(rootDir, 'superpowers/planner')
  await writeSkill(rootDir, 'design-tools/palette')
})

afterEach(async () => {
  await removeTempDir(rootDir)
})

test('getAddCompletions suggests matching group and leaf paths', async () => {
  expect(await getAddCompletions(rootDir, 'sup')).toEqual([
    {
      value: 'superpowers',
      label: 'superpowers',
      description: 'group • 2 skills',
    },
    {
      value: 'superpowers/agent-browser',
      label: 'superpowers/agent-browser',
      description: 'skill • 1 skill',
    },
    {
      value: 'superpowers/planner',
      label: 'superpowers/planner',
      description: 'skill • 1 skill',
    },
  ])
})

test('getAddCompletions returns null when the root directory is missing', async () => {
  expect(await getAddCompletions(`${rootDir}/missing`, 'sup')).toBeNull()
})

test('getRemoveCompletions only returns active selections matching the prefix', () => {
  expect(getRemoveCompletions(['superpowers', 'design-tools'], 'sup')).toEqual([
    {
      value: 'superpowers',
      label: 'superpowers',
      description: 'active selection',
    },
  ])
})
