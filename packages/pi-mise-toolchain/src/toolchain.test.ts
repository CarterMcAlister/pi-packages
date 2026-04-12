import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import {
  configLoader,
  DEFAULT_CONFIG,
  DEFAULT_EXTENSION_CONFIG,
  findLegacyLocalConfigPath,
  getIgnoredLegacyProjectSettingsWarning,
  type ResolvedToolchainConfig,
  resolveExtensionConfig,
  resolveRuntimeConfig,
  type ToolchainConfig,
} from './config'
import { registerBashIntegration } from './hooks/bash-integration'
import {
  hasRewriteFeatures,
  registerRewriteNotifications,
} from './hooks/rewrite-notifications'
import {
  DEFAULT_PROJECT_TOOLCHAIN_CONFIG,
  findProjectToolchainConfig,
} from './project-config'
import {
  BASH_SPAWN_HOOK_REQUEST_EVENT,
  TOOLCHAIN_SPAWN_HOOK_CONTRIBUTOR_ID,
} from './utils/bash-composition'
import {
  CURRENT_VERSION,
  isMissingBashSourceMode,
  migrateV0,
} from './utils/migration'

function createPiStub() {
  const toolCallHandlers: Array<Parameters<ExtensionAPI['on']>[1]> = []
  const eventHandlers = new Map<string, (data: unknown) => void>()
  const registeredTools: unknown[] = []

  const pi = {
    on(eventName: string, handler: Parameters<ExtensionAPI['on']>[1]) {
      if (eventName === 'tool_call') {
        toolCallHandlers.push(handler)
      }
    },
    registerTool(tool: unknown) {
      registeredTools.push(tool)
    },
    events: {
      on(eventName: string, handler: (data: unknown) => void) {
        eventHandlers.set(eventName, handler)
      },
    },
  } as unknown as ExtensionAPI

  return { pi, toolCallHandlers, eventHandlers, registeredTools }
}

function withRuntimeConfig(
  extensionConfig: ToolchainConfig,
  projectConfig = DEFAULT_PROJECT_TOOLCHAIN_CONFIG,
): ResolvedToolchainConfig {
  return resolveRuntimeConfig(
    resolveExtensionConfig(extensionConfig),
    projectConfig,
  )
}

describe('toolchain config', () => {
  it('defaults bash.sourceMode to override-bash', () => {
    const resolved = resolveExtensionConfig({})

    expect(resolved.bash.sourceMode).toBe('override-bash')
  })

  it('rejects invalid bash.sourceMode', () => {
    expect(() =>
      resolveExtensionConfig({
        bash: {
          sourceMode: 'wrong-mode' as 'override-bash',
        },
      }),
    ).toThrow(/bash\.sourceMode must be "override-bash" or "composed-bash"/)
  })

  it('migrateV0 handles legacy feature migration and leaves sourceMode to the dedicated migration', () => {
    const migrated = migrateV0({
      enabled: true,
      features: {
        enforcePackageManager: true as unknown as never,
      },
    })

    expect(migrated.bash?.sourceMode).toBeUndefined()
    expect(isMissingBashSourceMode(migrated)).toBe(true)
    expect(migrated.version).toBe(CURRENT_VERSION)
    expect(migrated.features?.enforcePackageManager).toBe('rewrite')
  })

  it('does not run missing-source-mode migration when sourceMode already exists', () => {
    const config = {
      version: '0.5.1-old',
      bash: { sourceMode: 'composed-bash' },
    } satisfies ToolchainConfig

    expect(isMissingBashSourceMode(config)).toBe(false)
    expect(resolveExtensionConfig(config).bash.sourceMode).toBe('composed-bash')
  })

  it('uses only global and memory scopes for JSON-backed settings', () => {
    expect(configLoader.getEnabledScopes()).toEqual(['global', 'memory'])
  })

  it('warns when legacy JSON project toolchain settings are still present', () => {
    expect(
      getIgnoredLegacyProjectSettingsWarning({
        features: { rewritePython: 'rewrite' },
        packageManager: { selected: 'pnpm' },
      }),
    ).toMatch(/nearest mise\.toml/)

    expect(
      getIgnoredLegacyProjectSettingsWarning({
        features: { gitRebaseEditor: 'rewrite' },
      }),
    ).toBeNull()
  })

  it('finds an ignored legacy local toolchain config in parent directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolchain-local-config-'))
    const nestedDir = join(root, 'packages', 'extension')
    const legacyConfigPath = join(root, '.pi', 'extensions', 'toolchain.json')

    await mkdir(join(root, '.pi', 'extensions'), { recursive: true })
    await writeFile(legacyConfigPath, '{}\n')
    await mkdir(nestedDir, { recursive: true })

    expect(findLegacyLocalConfigPath(nestedDir)).toBe(legacyConfigPath)
  })

  it('DEFAULT_CONFIG keeps backward-compatible override-bash behavior', () => {
    expect(DEFAULT_CONFIG.bash.sourceMode).toBe('override-bash')
    expect(DEFAULT_EXTENSION_CONFIG.bash.sourceMode).toBe('override-bash')
  })
})

describe('project toolchain config from mise.toml', () => {
  it('derives python rewrite when mise.toml declares uv', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolchain-mise-'))
    await writeFile(join(root, 'mise.toml'), "[tools]\nuv = 'latest'\n")

    const project = await findProjectToolchainConfig(root)

    expect(project.features.rewritePython).toBe('rewrite')
    expect(project.features.enforcePackageManager).toBe('disabled')
    expect(project.packageManager.selected).toBeNull()
  })

  it('enables package-manager rewriting only when exactly one supported manager is declared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolchain-mise-'))
    await writeFile(join(root, 'mise.toml'), "[tools]\npnpm = '10'\n")

    const project = await findProjectToolchainConfig(root)

    expect(project.features.enforcePackageManager).toBe('rewrite')
    expect(project.packageManager.selected).toBe('pnpm')
  })

  it('disables package-manager rewriting when multiple managers are declared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolchain-mise-'))
    await writeFile(
      join(root, 'mise.toml'),
      "[tools]\npnpm = '10'\nbun = '1'\n",
    )

    const project = await findProjectToolchainConfig(root)

    expect(project.features.enforcePackageManager).toBe('disabled')
    expect(project.packageManager.selected).toBeNull()
  })

  it('uses the nearest ancestor mise.toml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolchain-mise-'))
    const nestedDir = join(root, 'packages', 'extension')

    await writeFile(join(root, 'mise.toml'), "[tools]\npnpm = '10'\n")
    await mkdir(nestedDir, { recursive: true })
    await writeFile(join(nestedDir, 'mise.toml'), "[tools]\nbun = '1'\n")

    const project = await findProjectToolchainConfig(join(nestedDir, 'src'))

    expect(project.packageManager.selected).toBe('bun')
    expect(project.features.enforcePackageManager).toBe('rewrite')
  })

  it('fails open when mise.toml is malformed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'toolchain-mise-'))
    await writeFile(join(root, 'mise.toml'), '[tools\nuv = ')

    const project = await findProjectToolchainConfig(root)

    expect(project.features.rewritePython).toBe('disabled')
    expect(project.features.enforcePackageManager).toBe('disabled')
    expect(project.packageManager.selected).toBeNull()
  })
})

describe('toolchain bash integration', () => {
  it('hasRewriteFeatures is false when no rewrite feature is enabled', () => {
    const config = withRuntimeConfig({
      features: {
        gitRebaseEditor: 'disabled',
      },
    })

    expect(hasRewriteFeatures(config)).toBe(false)
  })

  it('registers local bash in override-bash mode', () => {
    const { pi, eventHandlers, registeredTools } = createPiStub()
    const config = withRuntimeConfig(
      {
        bash: { sourceMode: 'override-bash' },
      },
      {
        sourcePath: '/tmp/mise.toml',
        features: {
          enforcePackageManager: 'rewrite',
          rewritePython: 'disabled',
        },
        packageManager: {
          selected: 'pnpm',
        },
      },
    )

    registerBashIntegration(pi, config)

    expect(registeredTools).toHaveLength(1)
    expect(eventHandlers.has(BASH_SPAWN_HOOK_REQUEST_EVENT)).toBe(false)
  })

  it('contributes to composer in composed-bash mode', () => {
    const { pi, eventHandlers, registeredTools } = createPiStub()
    const config = withRuntimeConfig(
      {
        bash: { sourceMode: 'composed-bash' },
      },
      {
        sourcePath: '/tmp/mise.toml',
        features: {
          enforcePackageManager: 'rewrite',
          rewritePython: 'disabled',
        },
        packageManager: {
          selected: 'pnpm',
        },
      },
    )

    registerBashIntegration(pi, config)

    expect(registeredTools).toHaveLength(0)
    const handler = eventHandlers.get(BASH_SPAWN_HOOK_REQUEST_EVENT)
    expect(handler).toBeTypeOf('function')

    const contributions: Array<{ id: string; spawnHook: unknown }> = []
    handler?.({
      register(contributor: { id: string; spawnHook: unknown }) {
        contributions.push(contributor)
      },
    })

    expect(contributions).toHaveLength(1)
    expect(contributions[0]?.id).toBe(TOOLCHAIN_SPAWN_HOOK_CONTRIBUTOR_ID)
    expect(contributions[0]?.spawnHook).toBeTypeOf('function')
  })

  it('rewrite notifications include source-mode prefix', async () => {
    const { pi, toolCallHandlers } = createPiStub()
    const config = withRuntimeConfig(
      {
        features: { gitRebaseEditor: 'rewrite' },
        bash: { sourceMode: 'composed-bash' },
        ui: { showRewriteNotifications: true },
      },
      {
        sourcePath: '/tmp/mise.toml',
        features: {
          enforcePackageManager: 'disabled',
          rewritePython: 'disabled',
        },
        packageManager: {
          selected: null,
        },
      },
    )

    registerRewriteNotifications(pi, config)

    expect(toolCallHandlers).toHaveLength(1)

    const messages: string[] = []
    await toolCallHandlers[0](
      {
        toolName: 'bash',
        input: { command: 'git rebase -i HEAD~1' },
      } as never,
      {
        ui: {
          notify(message: string) {
            messages.push(message)
          },
        },
      } as never,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0] ?? '').toMatch(/^\[composed-bash\] /)
  })
})
