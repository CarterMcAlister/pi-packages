import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import { PROFILE_STATE_ENTRY_TYPE, PROFILES_COMMAND } from '../src/constants'
import { loadProfileExtensionsIntoPi } from '../src/extension-loader'
import { createPiProfiles } from '../src/index'
import { resolveProfileResources } from '../src/resource-resolution'
import { createProfileState } from '../src/state'

interface HandlerMap {
  [eventName: string]: Array<(event: unknown, ctx: ExtensionContext) => unknown>
}

type CustomRenderComponent = {
  render(width: number): string[]
}

type CustomFactory = (
  tui: { requestRender: () => void },
  theme: {
    fg: (_color: string, text: string) => string
    bold: (text: string) => string
  },
  keybindings: Record<string, never>,
  done: (result: unknown) => void,
) => CustomRenderComponent | Promise<CustomRenderComponent>

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
    inputs?: Array<string | undefined>
    customResults?: unknown[]
  } = {},
) {
  const notifications: Array<{ message: string; level: string }> = []
  const customRenders: string[][] = []
  let reloaded = false
  const pendingInputs = [...(options.inputs ?? [])]
  const pendingCustomResults = [...(options.customResults ?? [])]

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
      setWorkingMessage() {},
      setTheme() {
        return { success: true }
      },
      async select() {
        return options.selection
      },
      async input() {
        return pendingInputs.shift()
      },
      async custom(factory: unknown) {
        const component = await (factory as CustomFactory)(
          { requestRender() {} },
          {
            fg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
          {},
          () => {},
        )

        customRenders.push(component.render(120))
        return pendingCustomResults.shift()
      },
    },
    reload: async () => {
      reloaded = true
    },
  } as unknown as ExtensionContext

  return {
    ctx,
    notifications,
    customRenders,
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
  expect(resources.skillPaths).toContain(skillPath)
})

test('resolveProfileResources can select individual skills from a skillpack', async () => {
  const reviewerSkillPath = await writeSkill(skillpackRoot, 'helpers/reviewer')
  const plannerSkillPath = await writeSkill(skillpackRoot, 'helpers/planner')

  await writeProfile(globalProfilesRoot, 'dev', {
    skillpacks: [
      {
        path: 'helpers',
        skills: ['reviewer'],
      },
    ],
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

  expect(resources.skillPaths).toContain(reviewerSkillPath)
  expect(resources.skillPaths).not.toContain(plannerSkillPath)
})

test('registers only the /profiles command', async () => {
  const fakePi = createFakePi()

  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  expect(Array.from(fakePi.commands.keys())).toEqual([PROFILES_COMMAND])
})

test('/profiles <name> persists active profile and reloads the session', async () => {
  const fakePi = createFakePi()
  await writeProfile(globalProfilesRoot, 'dev', {})
  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  const command = fakePi.commands.get(PROFILES_COMMAND)
  const context = createCommandContext(projectRoot)

  expect(command).toBeDefined()

  if (!command) {
    throw new Error('Expected /profiles to be registered')
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

test('/profiles none unloads the active profile', async () => {
  const fakePi = createFakePi()
  await writeProfile(globalProfilesRoot, 'dev', {})
  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  const command = fakePi.commands.get(PROFILES_COMMAND)
  const context = createCommandContext(projectRoot, [
    {
      type: 'custom',
      customType: PROFILE_STATE_ENTRY_TYPE,
      data: createProfileState({ scope: 'user', name: 'dev' }),
    },
  ])

  expect(command).toBeDefined()

  if (!command) {
    throw new Error('Expected /profiles to be registered')
  }

  await command.handler('none', context.ctx)

  expect(fakePi.appended.at(-1)).toEqual({
    customType: PROFILE_STATE_ENTRY_TYPE,
    data: createProfileState(null),
  })
  expect(context.reloaded).toBe(true)
  expect(context.notifications.at(-1)).toEqual({
    message: 'Unloaded profile "user:dev". Reloading…',
    level: 'info',
  })
})

test('/profiles works through the documented SDK setup', async () => {
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

  await session.prompt('/profiles user:dev')

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

test('/profiles overlays standard settings and passes through mcp-style fields', async () => {
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

  await session.prompt('/profiles user:ops')

  expect(session.settingsManager.getCompactionEnabled()).toBe(false)
  expect(session.settingsManager.getCompactionReserveTokens()).toBe(8192)
  expect(session.settingsManager.getRetryEnabled()).toBe(false)
  expect(session.settingsManager.getTransport()).toBe('websocket')
  expect(session.settingsManager.getHideThinkingBlock()).toBe(true)
  expect(session.settingsManager.getEnableSkillCommands()).toBe(false)
  expect(session.settingsManager.getPromptTemplatePaths()).toContain(
    join(globalProfilesRoot, 'ops', 'profile-prompts'),
  )
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

test('/profiles picker shows profile description when set', async () => {
  const fakePi = createFakePi()

  await writeProfile(globalProfilesRoot, 'described', {
    description: 'Useful reviewer workflow',
  })
  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  const command = fakePi.commands.get(PROFILES_COMMAND)
  const context = createCommandContext(projectRoot, [], {
    customResults: [{ type: 'cancel' }],
  })

  expect(command).toBeDefined()

  if (!command) {
    throw new Error('Expected /profiles to be registered')
  }

  await command.handler('', context.ctx)

  expect(context.customRenders.flat().join('\n')).toContain(
    'Useful reviewer workflow',
  )
})

test('/profiles UI can copy the hovered profile', async () => {
  const fakePi = createFakePi()
  const sourceSettings = {
    defaultThinkingLevel: 'high',
    skillpacks: ['helpers'],
    prompts: ['./prompt-dir'],
  }

  await writeProfile(globalProfilesRoot, 'source', sourceSettings)
  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  const command = fakePi.commands.get(PROFILES_COMMAND)
  const context = createCommandContext(projectRoot, [], {
    customResults: [{ type: 'copy', value: 'user:source' }, { type: 'cancel' }],
    inputs: ['project:copied'],
  })

  expect(command).toBeDefined()

  if (!command) {
    throw new Error('Expected /profiles to be registered')
  }

  await command.handler('', context.ctx)

  const copiedPath = join(projectProfilesRoot, 'copied', 'settings.json')
  expect(await readFile(copiedPath, 'utf8')).toEqual(
    `${JSON.stringify(sourceSettings, null, 2)}\n`,
  )
  expect(context.notifications.at(-1)).toEqual({
    message: 'Copied profile "user:source" to "project:copied".',
    level: 'info',
  })
})

test('/profiles UI copy can be cancelled at the name prompt', async () => {
  const fakePi = createFakePi()
  const sourceSettings = {
    defaultThinkingLevel: 'high',
  }

  await writeProfile(globalProfilesRoot, 'source', sourceSettings)
  await createPiProfiles({
    agentDir,
    globalRoot: globalProfilesRoot,
    projectRoot: projectProfilesRoot,
    skillpackRoot,
  })(fakePi.api)

  const command = fakePi.commands.get(PROFILES_COMMAND)
  const context = createCommandContext(projectRoot, [], {
    customResults: [{ type: 'copy', value: 'user:source' }, { type: 'cancel' }],
    inputs: [undefined],
  })

  expect(command).toBeDefined()

  if (!command) {
    throw new Error('Expected /profiles to be registered')
  }

  await command.handler('', context.ctx)

  await expect(
    readFile(join(projectProfilesRoot, 'source-copy', 'settings.json'), 'utf8'),
  ).rejects.toThrow()
  expect(
    context.notifications.some((notification) =>
      notification.message.includes('Copied profile'),
    ),
  ).toBe(false)
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

  expect(result.skillPaths).toContain(skillPath)
  expect(result.promptPaths).toEqual([promptPath])
  expect(result.themePaths).toEqual([themePath])
})
