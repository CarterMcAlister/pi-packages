import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import {
  SKILLPACKS_COMMAND,
  SKILLPACKS_INSTALL_COMMAND,
  SKILLPACKS_SEARCH_COMMAND,
  STATE_ENTRY_TYPE,
} from '../src/constants'
import { getSkillpackInstallDirectory } from '../src/github-skills'
import skillpackSessionLoader, {
  createSkillpackSessionLoader,
} from '../src/skillpack-session-loader'
import {
  createTempSkillpackRoot,
  removeTempDir,
  toRelativePaths,
  writeSkill,
} from './support/skillpack-fixtures'

type Handler = (
  event: unknown,
  ctx: ExtensionContext,
) => Promise<unknown> | unknown

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionContext) => Promise<unknown> | unknown
}

type InstallCall = {
  repoRef: string
  skillPath: string
  directory: string
  options: { force?: boolean }
}

function createFakePi() {
  const commands = new Map<string, RegisteredCommand>()
  const events = new Map<string, Handler>()
  const appended: Array<{ customType: string; data: unknown }> = []

  const api = {
    on(eventName: string, handler: Handler) {
      events.set(eventName, handler)
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command as RegisteredCommand)
    },
    appendEntry(customType: string, data: unknown) {
      appended.push({ customType, data })
    },
  } as unknown as ExtensionAPI

  return {
    commands,
    events,
    appended,
    api,
  }
}

function createFakeGhClient(
  options: {
    searchResults?: Array<{
      repo: string
      skillName: string
      namespace: string
      description: string
      stars: number
      path: string
    }>
    skillPaths?: string[]
  } = {},
) {
  const installs: InstallCall[] = []
  const searches: Array<{ query: string; limit?: number }> = []
  const discoveries: string[] = []

  return {
    installs,
    searches,
    discoveries,
    client: {
      async searchSkills(query: string, limit?: number) {
        searches.push({ query, limit })
        return options.searchResults ?? []
      },
      async discoverRepoSkillPaths(repoRef: string) {
        discoveries.push(repoRef)
        return options.skillPaths ?? []
      },
      async installSkill(
        repoRef: string,
        skillPath: string,
        directory: string,
        installOptions: { force?: boolean } = {},
      ) {
        installs.push({
          repoRef,
          skillPath,
          directory,
          options: installOptions,
        })
      },
    },
  }
}

function createCommandContext(
  branchEntries: unknown[],
  options: {
    cwd?: string
    customResult?: string[] | null
    inputResult?: string | undefined
    selectResult?: string | undefined
    selectResolver?:
      | ((title: string, values: string[]) => string | undefined)
      | undefined
    confirmResult?: boolean
  } = {},
) {
  const notifications: Array<{ message: string; level: string }> = []
  const selects: Array<{ title: string; values: string[] }> = []
  const confirms: Array<{ title: string; message: string }> = []
  const statuses: Array<{ key: string; text: string | undefined }> = []
  const workingMessages: Array<string | undefined> = []
  let reloaded = false

  const ctx = {
    cwd: options.cwd ?? process.cwd(),
    sessionManager: {
      getBranch: () => branchEntries,
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level })
      },
      custom: async () => options.customResult ?? null,
      input: async () => options.inputResult,
      select: async (title: string, values: string[]) => {
        selects.push({ title, values })
        return options.selectResolver
          ? options.selectResolver(title, values)
          : options.selectResult
      },
      confirm: async (title: string, message: string) => {
        confirms.push({ title, message })
        return options.confirmResult ?? true
      },
      setStatus(key: string, text: string | undefined) {
        statuses.push({ key, text })
      },
      setWorkingMessage(message?: string) {
        workingMessages.push(message)
      },
    },
    reload: async () => {
      reloaded = true
    },
  } as unknown as ExtensionContext

  return {
    notifications,
    selects,
    confirms,
    statuses,
    workingMessages,
    get reloaded() {
      return reloaded
    },
    ctx,
  }
}

let rootDir = ''

beforeEach(async () => {
  rootDir = await createTempSkillpackRoot()
  await writeSkill(rootDir, 'superpowers/agent-browser')
  await writeSkill(rootDir, 'superpowers/planner')
  await mkdir(join(rootDir, 'empty-pack'), { recursive: true })
})

afterEach(async () => {
  await removeTempDir(rootDir)
})

test('default export is a function', () => {
  expect(typeof skillpackSessionLoader).toBe('function')
})

test('registers expected commands and events', () => {
  const fakePi = createFakePi()

  createSkillpackSessionLoader({ rootDir })(fakePi.api)

  expect(fakePi.commands.has(SKILLPACKS_COMMAND)).toBe(true)
  expect(fakePi.commands.has(SKILLPACKS_INSTALL_COMMAND)).toBe(true)
  expect(fakePi.commands.has(SKILLPACKS_SEARCH_COMMAND)).toBe(true)
  expect(fakePi.events.has('session_start')).toBe(true)
  expect(fakePi.events.has('session_tree')).toBe(true)
  expect(fakePi.events.has('resources_discover')).toBe(true)
})

test('skillpacks command persists the selections returned by the UI and reloads', async () => {
  const fakePi = createFakePi()
  createSkillpackSessionLoader({ rootDir })(fakePi.api)

  const skillpacksCommand = fakePi.commands.get(SKILLPACKS_COMMAND)
  const context = createCommandContext([], { customResult: ['superpowers'] })

  expect(skillpacksCommand).toBeDefined()

  if (!skillpacksCommand) {
    throw new Error('Expected skillpacks command to be registered')
  }

  await skillpacksCommand.handler('', context.ctx)

  expect(fakePi.appended).toEqual([
    {
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['superpowers'] },
    },
  ])
  expect(context.reloaded).toBe(true)
  expect(context.notifications.at(-1)).toEqual({
    message: 'Updated skillpack selections (1 selection). Reloading…',
    level: 'info',
  })
})

test('skillpacks:install installs all discovered skills, enables the skillpack, and reloads', async () => {
  const fakePi = createFakePi()
  const fakeGh = createFakeGhClient({
    skillPaths: ['skills/obra/alpha', 'skills/obra/beta'],
  })

  createSkillpackSessionLoader({
    rootDir,
    ghClient: fakeGh.client,
  })(fakePi.api)

  const installCommand = fakePi.commands.get(SKILLPACKS_INSTALL_COMMAND)
  const context = createCommandContext([])

  expect(installCommand).toBeDefined()

  if (!installCommand) {
    throw new Error('Expected skillpacks:install command to be registered')
  }

  await installCommand.handler('obra/superpowers', context.ctx)

  expect(fakeGh.discoveries).toEqual(['obra/superpowers'])
  expect(fakeGh.installs).toEqual([
    {
      repoRef: 'obra/superpowers',
      skillPath: 'skills/obra/alpha',
      directory: getSkillpackInstallDirectory(rootDir, 'obra/superpowers'),
      options: { force: false },
    },
    {
      repoRef: 'obra/superpowers',
      skillPath: 'skills/obra/beta',
      directory: getSkillpackInstallDirectory(rootDir, 'obra/superpowers'),
      options: { force: false },
    },
  ])
  expect(fakePi.appended).toEqual([
    {
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['obra-superpowers'] },
    },
  ])
  expect(context.reloaded).toBe(true)
  expect(context.statuses).toEqual(
    expect.arrayContaining([
      {
        key: 'skills-install',
        text: 'Checking destination for obra/superpowers',
      },
      {
        key: 'skills-install',
        text: 'Discovering skills in obra/superpowers',
      },
      {
        key: 'skills-install',
        text: 'Installing obra/superpowers (1/2)',
      },
      {
        key: 'skills-install',
        text: 'Installing obra/superpowers (2/2)',
      },
      {
        key: 'skills-install',
        text: 'Reloading session with obra-superpowers',
      },
      { key: 'skills-install', text: undefined },
    ]),
  )
  expect(context.notifications.at(-1)).toEqual({
    message:
      'Installed 2 skills from "obra/superpowers" and enabled skillpack "obra-superpowers" for this session.',
    level: 'info',
  })
})

test('skillpacks:install asks before overwriting an existing skillpack directory', async () => {
  const fakePi = createFakePi()
  const fakeGh = createFakeGhClient({ skillPaths: ['skills/demo/alpha'] })
  const targetDir = getSkillpackInstallDirectory(rootDir, 'obra/superpowers')

  await mkdir(targetDir, { recursive: true })
  await writeFile(join(targetDir, 'existing.txt'), 'present')

  createSkillpackSessionLoader({
    rootDir,
    ghClient: fakeGh.client,
  })(fakePi.api)

  const installCommand = fakePi.commands.get(SKILLPACKS_INSTALL_COMMAND)
  const context = createCommandContext([], { confirmResult: true })

  expect(installCommand).toBeDefined()

  if (!installCommand) {
    throw new Error('Expected skillpacks:install command to be registered')
  }

  await installCommand.handler('obra/superpowers', context.ctx)

  expect(context.confirms).toHaveLength(1)
  expect(fakeGh.installs).toEqual([
    {
      repoRef: 'obra/superpowers',
      skillPath: 'skills/demo/alpha',
      directory: targetDir,
      options: { force: true },
    },
  ])
  expect(context.statuses).toEqual(
    expect.arrayContaining([
      {
        key: 'skills-install',
        text: 'Awaiting overwrite confirmation for obra/superpowers',
      },
    ]),
  )
})

test('skillpacks:search groups results by repo, shows progress, and installs the selected repository', async () => {
  const fakePi = createFakePi()
  const fakeGh = createFakeGhClient({
    searchResults: [
      {
        repo: 'github/skills',
        skillName: 'planner',
        namespace: 'github',
        description: 'Plan tasks well',
        stars: 4200,
        path: 'skills/github/planner/SKILL.md',
      },
      {
        repo: 'github/skills',
        skillName: 'reviewer',
        namespace: 'github',
        description: 'Review code well',
        stars: 4200,
        path: 'skills/github/reviewer/SKILL.md',
      },
      {
        repo: 'obra/superpowers',
        skillName: 'planner',
        namespace: 'obra',
        description: 'Alternative planner',
        stars: 100,
        path: 'skills/obra/planner/SKILL.md',
      },
    ],
    skillPaths: ['skills/github/planner'],
  })

  createSkillpackSessionLoader({
    rootDir,
    ghClient: fakeGh.client,
  })(fakePi.api)

  const searchCommand = fakePi.commands.get(SKILLPACKS_SEARCH_COMMAND)
  const context = createCommandContext([], {
    selectResolver: (_title, values) => values[0],
  })

  expect(searchCommand).toBeDefined()

  if (!searchCommand) {
    throw new Error('Expected skillpacks:search command to be registered')
  }

  await searchCommand.handler('planner', context.ctx)

  expect(fakeGh.searches).toEqual([{ query: 'planner', limit: 30 }])
  expect(context.selects).toHaveLength(1)
  expect(context.selects[0]?.values[0]).toContain('github/skills')
  expect(context.selects[0]?.values[0]).toContain('github/planner')
  expect(fakeGh.discoveries).toEqual(['github/skills'])
  expect(fakeGh.installs).toEqual([
    {
      repoRef: 'github/skills',
      skillPath: 'skills/github/planner',
      directory: getSkillpackInstallDirectory(rootDir, 'github/skills'),
      options: { force: false },
    },
  ])
  expect(fakePi.appended).toEqual([
    {
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['github-skills'] },
    },
  ])
  expect(context.reloaded).toBe(true)
  expect(context.statuses).toEqual(
    expect.arrayContaining([
      { key: 'skills-search', text: 'Searching GitHub for planner' },
      {
        key: 'skills-search',
        text: 'Found 2 matching repositories for planner',
      },
      {
        key: 'skills-search',
        text: 'Selected github/skills from search results',
      },
      { key: 'skills-search', text: undefined },
    ]),
  )
})

test('resources_discover returns the union of overlapping selections', async () => {
  const fakePi = createFakePi()
  createSkillpackSessionLoader({ rootDir })(fakePi.api)

  const resourcesDiscover = fakePi.events.get('resources_discover')
  const context = createCommandContext([
    {
      type: 'custom',
      customType: STATE_ENTRY_TYPE,
      data: {
        selectedPaths: ['superpowers', 'superpowers/agent-browser'],
      },
    },
  ])

  expect(resourcesDiscover).toBeDefined()

  if (!resourcesDiscover) {
    throw new Error('Expected resources_discover handler to be registered')
  }

  const result = await resourcesDiscover({ reason: 'startup' }, context.ctx)

  expect(
    toRelativePaths(rootDir, (result as { skillPaths: string[] }).skillPaths),
  ).toEqual([
    'superpowers/agent-browser/SKILL.md',
    'superpowers/planner/SKILL.md',
  ])
})

test('resources_discover loads global settings skillpacks using profile format', async () => {
  const fakePi = createFakePi()
  createSkillpackSessionLoader({ rootDir, agentDir: rootDir })(fakePi.api)
  await writeFile(
    join(rootDir, 'settings.json'),
    `${JSON.stringify(
      {
        skillpacks: [
          {
            path: 'superpowers',
            skills: ['agent-browser'],
          },
          'superpowers/planner',
        ],
      },
      null,
      2,
    )}\n`,
  )

  const resourcesDiscover = fakePi.events.get('resources_discover')
  const context = createCommandContext([], { cwd: rootDir })

  expect(resourcesDiscover).toBeDefined()

  if (!resourcesDiscover) {
    throw new Error('Expected resources_discover handler to be registered')
  }

  const result = await resourcesDiscover({ reason: 'startup' }, context.ctx)

  expect(
    toRelativePaths(rootDir, (result as { skillPaths: string[] }).skillPaths),
  ).toEqual([
    'superpowers/agent-browser/SKILL.md',
    'superpowers/planner/SKILL.md',
  ])
})
