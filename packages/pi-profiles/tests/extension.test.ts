import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'
import {
  PROFILE_LOAD_COMMAND,
  PROFILE_STATE_ENTRY_TYPE,
} from '../src/constants'
import { loadProfileExtensionsIntoPi } from '../src/extension-loader'
import { createPiProfiles } from '../src/index'
import { resolveProfileResources } from '../src/resource-resolution'
import { createProfileState } from '../src/state'

interface HandlerMap {
  [eventName: string]: Array<(event: unknown, ctx: ExtensionContext) => unknown>
}

function createFakePi() {
  const commands = new Map<
    string,
    { handler: (args: string, ctx: unknown) => Promise<void> }
  >()
  const events: HandlerMap = {}
  const appended: Array<{ customType: string; data: unknown }> = []
  const tools: string[] = []

  const api = {
    on(
      eventName: string,
      handler: (event: unknown, ctx: ExtensionContext) => unknown,
    ) {
      events[eventName] ??= []
      events[eventName]?.push(handler)
    },
    registerCommand(name: string, command: unknown) {
      commands.set(
        name,
        command as { handler: (args: string, ctx: unknown) => Promise<void> },
      )
    },
    appendEntry(customType: string, data: unknown) {
      appended.push({ customType, data })
    },
    setThinkingLevel() {},
    async setModel() {
      return true
    },
    registerTool(tool: { name: string }) {
      tools.push(tool.name)
    },
  } as unknown as ExtensionAPI

  return {
    api,
    commands,
    events,
    appended,
    tools,
  }
}

function createCommandContext(
  cwd: string,
  branchEntries: unknown[] = [],
  options: {
    selection?: string
  } = {},
) {
  const notifications: Array<{ message: string; level: string }> = []
  let reloaded = false

  const ctx = {
    cwd,
    hasUI: true,
    sessionManager: {
      getBranch: () => branchEntries,
      getSessionFile: () => join(cwd, 'session.jsonl'),
    },
    modelRegistry: {
      find: () => undefined,
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level })
      },
      setStatus() {},
      setTheme() {
        return { success: true }
      },
      async select() {
        return options.selection
      },
    },
    reload: async () => {
      reloaded = true
    },
  } as unknown as ExtensionContext

  return {
    ctx,
    notifications,
    get reloaded() {
      return reloaded
    },
  }
}

let tempDir = ''
let agentDir = ''
let globalProfilesRoot = ''
let projectRoot = ''
let projectProfilesRoot = ''
let skillpackRoot = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'pi-profiles-'))
  agentDir = join(tempDir, 'agent')
  globalProfilesRoot = join(agentDir, 'profiles')
  projectRoot = join(tempDir, 'workspace')
  projectProfilesRoot = join(projectRoot, '.pi', 'profiles')
  skillpackRoot = join(agentDir, 'skillpacks')

  await mkdir(globalProfilesRoot, { recursive: true })
  await mkdir(projectProfilesRoot, { recursive: true })
  await mkdir(skillpackRoot, { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

async function writeProfile(
  rootDir: string,
  name: string,
  settings: unknown,
): Promise<string> {
  const profileDir = join(rootDir, name)
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'settings.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
  )
  return profileDir
}

async function writeSkill(
  rootDir: string,
  logicalPath: string,
): Promise<string> {
  const skillDir = join(rootDir, ...logicalPath.split('/'))
  const skillPath = join(skillDir, 'SKILL.md')
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    skillPath,
    `---\nname: ${logicalPath}\ndescription: Test skill\n---\n\nUse me.\n`,
  )
  return skillPath
}

test('loadProfileExtensionsIntoPi executes external extension factories', async () => {
  const fakePi = createFakePi()
  const extensionPath = join(tempDir, 'external-extension.ts')

  await writeFile(
    extensionPath,
    `export default function (pi) {\n  pi.registerCommand('from_profile_extension', {\n    description: 'Loaded from profile',\n    async handler() {},\n  })\n}\n`,
  )

  await loadProfileExtensionsIntoPi(fakePi.api, [extensionPath], new Set())

  expect(fakePi.commands.has('from_profile_extension')).toBe(true)
})

test('resolveProfileResources resolves local resources and skillpacks', async () => {
  const promptPath = join(tempDir, 'local-prompts', 'review.md')
  const themePath = join(tempDir, 'local-themes', 'night.json')
  const extensionPath = join(tempDir, 'local-extensions', 'hello.ts')
  const skillPath = await writeSkill(skillpackRoot, 'superpowers/planner')

  await mkdir(join(tempDir, 'local-prompts'), { recursive: true })
  await mkdir(join(tempDir, 'local-themes'), { recursive: true })
  await mkdir(join(tempDir, 'local-extensions'), { recursive: true })
  await writeFile(promptPath, '# Review\n')
  await writeFile(themePath, '{"name":"night","type":"dark","colors":{}}\n')
  await writeFile(extensionPath, 'export default function () {}\n')

  await writeProfile(globalProfilesRoot, 'dev', {
    extensions: [extensionPath],
    prompts: [promptPath],
    themes: [themePath],
    skillpacks: ['superpowers'],
  })

  const resources = await resolveProfileResources(
    {
      scope: 'user',
      name: 'dev',
      rootDir: globalProfilesRoot,
      profileDir: join(globalProfilesRoot, 'dev'),
      settingsPath: join(globalProfilesRoot, 'dev', 'settings.json'),
    },
    {
      cwd: projectRoot,
      agentDir,
      skillpackRoot,
    },
  )

  expect(resources.extensionPaths).toEqual([extensionPath])
  expect(resources.promptPaths).toEqual([promptPath])
  expect(resources.themePaths).toEqual([themePath])
  expect(resources.skillPaths).toEqual([skillPath])
})

test('profile-load persists active profile and reloads the session', async () => {
  const fakePi = createFakePi()
  await writeProfile(globalProfilesRoot, 'dev', {})
  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  const command = fakePi.commands.get(PROFILE_LOAD_COMMAND)
  const context = createCommandContext(projectRoot)

  expect(command).toBeDefined()

  if (!command) {
    throw new Error('Expected profile-load to be registered')
  }

  await command.handler('user:dev', context.ctx)

  expect(fakePi.appended).toEqual([
    {
      customType: PROFILE_STATE_ENTRY_TYPE,
      data: createProfileState({ scope: 'user', name: 'dev' }),
    },
  ])
  expect(context.reloaded).toBe(true)
  expect(context.notifications.at(-1)).toEqual({
    message: 'Loaded profile "user:dev". Reloading…',
    level: 'info',
  })
})

test('profile-load works through the documented SDK setup', async () => {
  await writeSkill(skillpackRoot, 'helpers/planner')
  await writeProfile(globalProfilesRoot, 'dev', {
    skillpacks: ['helpers'],
  })

  const settingsManager = SettingsManager.inMemory()
  const resourceLoader = new DefaultResourceLoader({
    cwd: projectRoot,
    agentDir,
    settingsManager,
    extensionFactories: [
      createPiProfiles({
        agentDir,
        globalRoot: globalProfilesRoot,
        projectRoot: projectProfilesRoot,
        skillpackRoot,
      }),
    ],
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd: projectRoot,
    agentDir,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(projectRoot),
  })

  await session.prompt('/profile-load user:dev')

  const lastProfileState = session.sessionManager
    .getEntries()
    .filter(
      (entry) =>
        entry.type === 'custom' &&
        entry.customType === PROFILE_STATE_ENTRY_TYPE,
    )
    .at(-1) as { data?: unknown } | undefined

  expect(lastProfileState?.data).toEqual(
    createProfileState({ scope: 'user', name: 'dev' }),
  )

  session.dispose()
})

test('profile-load overlays standard settings and passes through mcp-style fields', async () => {
  await writeProfile(globalProfilesRoot, 'ops', {
    compaction: {
      enabled: false,
      reserveTokens: 8192,
    },
    retry: {
      enabled: false,
      maxRetries: 1,
    },
    transport: 'websocket',
    hideThinkingBlock: true,
    enableSkillCommands: false,
    prompts: ['./profile-prompts'],
    mcps: ['filesystem'],
    mcpServers: {
      filesystem: {
        command: 'uvx',
        args: ['mcp-server-filesystem'],
      },
    },
  })

  const settingsManager = SettingsManager.inMemory({
    prompts: ['existing-prompts'],
    enableSkillCommands: true,
    retry: {
      enabled: true,
    },
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: projectRoot,
    agentDir,
    settingsManager,
    extensionFactories: [
      createPiProfiles({
        agentDir,
        globalRoot: globalProfilesRoot,
        projectRoot: projectProfilesRoot,
        skillpackRoot,
      }),
    ],
  })
  await resourceLoader.reload()

  const { session } = await createAgentSession({
    cwd: projectRoot,
    agentDir,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(projectRoot),
  })

  await session.prompt('/profile-load user:ops')

  expect(session.settingsManager.getCompactionEnabled()).toBe(false)
  expect(session.settingsManager.getCompactionReserveTokens()).toBe(8192)
  expect(session.settingsManager.getRetryEnabled()).toBe(false)
  expect(session.settingsManager.getTransport()).toBe('websocket')
  expect(session.settingsManager.getHideThinkingBlock()).toBe(true)
  expect(session.settingsManager.getEnableSkillCommands()).toBe(false)
  expect(session.settingsManager.getPromptTemplatePaths()).toEqual([
    'existing-prompts',
    join(globalProfilesRoot, 'ops', 'profile-prompts'),
  ])
  expect(session.settingsManager.getProjectSettings()).toMatchObject({
    prompts: [join(globalProfilesRoot, 'ops', 'profile-prompts')],
    mcps: ['filesystem'],
    mcpServers: {
      filesystem: {
        command: 'uvx',
        args: ['mcp-server-filesystem'],
      },
    },
  })

  session.dispose()
})

test('resources_discover returns the active profile skill/theme/prompt paths', async () => {
  const fakePi = createFakePi()
  const promptPath = join(tempDir, 'project-prompts', 'notes.md')
  const themePath = join(tempDir, 'project-themes', 'light.json')
  const skillPath = await writeSkill(skillpackRoot, 'helpers/reviewer')

  await mkdir(join(tempDir, 'project-prompts'), { recursive: true })
  await mkdir(join(tempDir, 'project-themes'), { recursive: true })
  await writeFile(promptPath, '# Notes\n')
  await writeFile(themePath, '{"name":"light","type":"light","colors":{}}\n')
  await writeProfile(projectProfilesRoot, 'review', {
    prompts: [promptPath],
    themes: [themePath],
    skillpacks: ['helpers'],
  })

  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  const resourcesDiscover = fakePi.events.resources_discover?.[0]

  expect(resourcesDiscover).toBeDefined()

  if (!resourcesDiscover) {
    throw new Error('Expected resources_discover handler to be registered')
  }

  const context = createCommandContext(projectRoot, [
    {
      type: 'custom',
      customType: PROFILE_STATE_ENTRY_TYPE,
      data: createProfileState({ scope: 'project', name: 'review' }),
    },
  ])

  const result = (await resourcesDiscover(
    { type: 'resources_discover' },
    context.ctx,
  )) as {
    skillPaths?: string[]
    promptPaths?: string[]
    themePaths?: string[]
  }

  expect(result.skillPaths).toEqual([skillPath])
  expect(result.promptPaths).toEqual([promptPath])
  expect(result.themePaths).toEqual([themePath])
})
