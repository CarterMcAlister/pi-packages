import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  filterSkillpackBrowserItems,
  getSkillpackBrowserStatus,
  getVisibleSkillpackBrowserItems,
  loadSkillpackBrowserItems,
} from '../src/browser'
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

test('loadSkillpackBrowserItems loads skill metadata from SKILL.md', async () => {
  const items = await loadSkillpackBrowserItems(rootDir)
  const skill = items.find((item) => item.value === 'superpowers/agent-browser')

  expect(skill).toMatchObject({
    value: 'superpowers/agent-browser',
    kind: 'skill',
    depth: 1,
    title: 'superpowers-agent-browser',
    description: 'fixture skill',
  })
  expect(
    skill?.skillFilePath?.endsWith('superpowers/agent-browser/SKILL.md'),
  ).toBe(true)
  expect(skill?.body).toContain('Fixture skill.')
})

test('filterSkillpackBrowserItems includes parent groups for matching skills', async () => {
  const items = await loadSkillpackBrowserItems(rootDir)

  expect(
    filterSkillpackBrowserItems(items, 'browser').map((item) => item.value),
  ).toEqual(['superpowers', 'superpowers/agent-browser'])
})

test('filterSkillpackBrowserItems includes descendants when a group matches', async () => {
  const items = await loadSkillpackBrowserItems(rootDir)

  expect(
    filterSkillpackBrowserItems(items, 'superpowers').map((item) => item.value),
  ).toEqual(['superpowers', 'superpowers/agent-browser', 'superpowers/planner'])
})

test('getVisibleSkillpackBrowserItems hides descendants of collapsed groups', async () => {
  const items = await loadSkillpackBrowserItems(rootDir)

  expect(
    getVisibleSkillpackBrowserItems(items, '', ['superpowers']).map(
      (item) => item.value,
    ),
  ).toEqual(['design-tools', 'design-tools/palette', 'superpowers'])
})

test('getVisibleSkillpackBrowserItems keeps search results visible even when a group is collapsed', async () => {
  const items = await loadSkillpackBrowserItems(rootDir)

  expect(
    getVisibleSkillpackBrowserItems(items, 'browser', ['superpowers']).map(
      (item) => item.value,
    ),
  ).toEqual(['superpowers', 'superpowers/agent-browser'])
})

test('getSkillpackBrowserStatus distinguishes explicit, active, partial, and inactive states', async () => {
  const items = await loadSkillpackBrowserItems(rootDir)
  const group = items.find((item) => item.value === 'superpowers')
  const skill = items.find((item) => item.value === 'superpowers/agent-browser')

  expect(group).toBeDefined()
  expect(skill).toBeDefined()

  if (!group || !skill) {
    throw new Error(
      'Expected skillpack browser fixtures to include superpowers items',
    )
  }

  expect(getSkillpackBrowserStatus(items, ['superpowers'], group)).toBe(
    'explicit',
  )
  expect(getSkillpackBrowserStatus(items, ['superpowers'], skill)).toBe(
    'active',
  )
  expect(
    getSkillpackBrowserStatus(items, ['superpowers/agent-browser'], group),
  ).toBe('partial')
  expect(
    getSkillpackBrowserStatus(
      items,
      ['superpowers/agent-browser', 'superpowers/planner'],
      group,
    ),
  ).toBe('active')
  expect(getSkillpackBrowserStatus(items, [], group)).toBe('inactive')
})
