import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { ConfigLoader, type Migration } from '@aliou/pi-utils-settings'
import { DEFAULT_PROJECT_TOOLCHAIN_CONFIG } from './project-config'
import { isValidBashSourceMode } from './utils/bash-source-mode'
import {
  isMissingBashSourceMode,
  isV0,
  migrateMissingBashSourceMode,
  migrateV0,
  pendingWarnings,
} from './utils/migration'

/**
 * Configuration schema for the toolchain extension.
 *
 * ToolchainConfig is the JSON-backed user-facing schema (all fields optional).
 * ResolvedExtensionConfig is the JSON-backed internal schema.
 * ResolvedToolchainConfig is the final runtime schema after overlaying project
 * toolchain settings derived from mise.toml.
 *
 * Feature modes:
 * - "disabled": feature is off
 * - "rewrite": transparently rewrite matching commands via spawn hook
 * - "block": block matching commands via tool_call hook (bash tool not overridden)
 */

export type FeatureMode = 'disabled' | 'rewrite' | 'block'
export type BashSourceMode = 'override-bash' | 'composed-bash'
export type PackageManager = 'bun' | 'pnpm' | 'npm'

export interface ToolchainConfig {
  version?: string
  enabled?: boolean
  features?: {
    enforcePackageManager?: FeatureMode
    rewritePython?: FeatureMode
    gitRebaseEditor?: FeatureMode
  }
  packageManager?: {
    selected?: PackageManager
  }
  bash?: {
    sourceMode?: BashSourceMode
  }
  ui?: {
    showRewriteNotifications?: boolean
  }
}

export interface ProjectToolchainConfig {
  sourcePath: string | null
  features: {
    enforcePackageManager: FeatureMode
    rewritePython: FeatureMode
  }
  packageManager: {
    selected: PackageManager | null
  }
}

export interface ResolvedExtensionConfig {
  enabled: boolean
  features: {
    gitRebaseEditor: FeatureMode
  }
  bash: {
    sourceMode: BashSourceMode
  }
  ui: {
    showRewriteNotifications: boolean
  }
}

export interface ResolvedToolchainConfig {
  enabled: boolean
  features: {
    enforcePackageManager: FeatureMode
    rewritePython: FeatureMode
    gitRebaseEditor: FeatureMode
  }
  packageManager: {
    selected: PackageManager
  }
  bash: {
    sourceMode: BashSourceMode
  }
  ui: {
    showRewriteNotifications: boolean
  }
}

export const DEFAULT_EXTENSION_CONFIG: ResolvedExtensionConfig = {
  enabled: true,
  features: {
    gitRebaseEditor: 'rewrite',
  },
  bash: {
    sourceMode: 'override-bash',
  },
  ui: {
    showRewriteNotifications: false,
  },
}

export const DEFAULT_CONFIG: ResolvedToolchainConfig = {
  enabled: DEFAULT_EXTENSION_CONFIG.enabled,
  features: {
    enforcePackageManager:
      DEFAULT_PROJECT_TOOLCHAIN_CONFIG.features.enforcePackageManager,
    rewritePython: DEFAULT_PROJECT_TOOLCHAIN_CONFIG.features.rewritePython,
    gitRebaseEditor: DEFAULT_EXTENSION_CONFIG.features.gitRebaseEditor,
  },
  packageManager: {
    selected:
      DEFAULT_PROJECT_TOOLCHAIN_CONFIG.packageManager.selected ?? 'pnpm',
  },
  bash: {
    sourceMode: DEFAULT_EXTENSION_CONFIG.bash.sourceMode,
  },
  ui: {
    showRewriteNotifications:
      DEFAULT_EXTENSION_CONFIG.ui.showRewriteNotifications,
  },
}

export const IGNORED_PROJECT_SETTINGS_WARNING =
  '[toolchain] Ignoring legacy toolchain.json project settings for package-manager and Python rewrites. These settings now come from the nearest mise.toml.'

let hasQueuedIgnoredProjectSettingsWarning = false
let hasQueuedIgnoredLocalConfigWarning = false

const migrations: Migration<ToolchainConfig>[] = [
  {
    name: 'v0-to-current',
    shouldRun: (config) => isV0(config),
    run: (config) => migrateV0(config),
  },
  {
    name: 'add-bash-source-mode',
    shouldRun: (config) => isMissingBashSourceMode(config),
    run: (config) => migrateMissingBashSourceMode(config),
  },
]

function deepMerge(target: object, source: object): void {
  const t = target as Record<string, unknown>
  const s = source as Record<string, unknown>

  for (const key in s) {
    if (s[key] === undefined) continue
    if (
      typeof s[key] === 'object' &&
      !Array.isArray(s[key]) &&
      s[key] !== null
    ) {
      if (!t[key] || typeof t[key] !== 'object') t[key] = {}
      deepMerge(t[key] as object, s[key] as object)
    } else {
      t[key] = s[key]
    }
  }
}

function mergeToolchainConfigs(
  ...configs: Array<ToolchainConfig | null | undefined>
): ToolchainConfig {
  const merged: ToolchainConfig = {}

  for (const config of configs) {
    if (config) {
      deepMerge(merged, config)
    }
  }

  return merged
}

export function getIgnoredLegacyProjectSettingsWarning(
  config: ToolchainConfig | null | undefined,
): string | null {
  const hasLegacyProjectSettings =
    config?.features?.enforcePackageManager !== undefined ||
    config?.features?.rewritePython !== undefined ||
    config?.packageManager?.selected !== undefined

  return hasLegacyProjectSettings ? IGNORED_PROJECT_SETTINGS_WARNING : null
}

function queueIgnoredLegacyProjectSettingsWarning(
  config: ToolchainConfig | null | undefined,
): void {
  if (hasQueuedIgnoredProjectSettingsWarning) return

  const warning = getIgnoredLegacyProjectSettingsWarning(config)
  if (!warning) return

  pendingWarnings.push(warning)
  hasQueuedIgnoredProjectSettingsWarning = true
}

export function findLegacyLocalConfigPath(
  startDir = process.cwd(),
): string | null {
  let dir = startDir
  const home = homedir()

  while (true) {
    if (dir === home) return null

    const candidate = resolve(dir, '.pi/extensions/toolchain.json')
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }

    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function queueIgnoredLegacyLocalConfigWarning(
  startDir = process.cwd(),
): void {
  if (hasQueuedIgnoredLocalConfigWarning) return

  const path = findLegacyLocalConfigPath(startDir)
  if (!path) return

  pendingWarnings.push(
    `[toolchain] Ignoring legacy project config at ${path}. Project package-manager and Python rewrites now come from the nearest mise.toml.`,
  )
  hasQueuedIgnoredLocalConfigWarning = true
}

function validateResolvedExtensionConfig(
  config: ResolvedExtensionConfig,
): ResolvedExtensionConfig {
  if (!isValidBashSourceMode(config.bash.sourceMode)) {
    throw new Error(
      '[toolchain] Invalid config: bash.sourceMode must be "override-bash" or "composed-bash"',
    )
  }

  return config
}

function validateResolvedConfig(
  config: ResolvedToolchainConfig,
): ResolvedToolchainConfig {
  validateResolvedExtensionConfig({
    enabled: config.enabled,
    features: {
      gitRebaseEditor: config.features.gitRebaseEditor,
    },
    bash: config.bash,
    ui: config.ui,
  })

  return config
}

export function resolveExtensionConfig(
  config: ToolchainConfig | null | undefined,
): ResolvedExtensionConfig {
  return validateResolvedExtensionConfig({
    enabled: config?.enabled ?? DEFAULT_EXTENSION_CONFIG.enabled,
    features: {
      gitRebaseEditor:
        config?.features?.gitRebaseEditor ??
        DEFAULT_EXTENSION_CONFIG.features.gitRebaseEditor,
    },
    bash: {
      sourceMode:
        config?.bash?.sourceMode ?? DEFAULT_EXTENSION_CONFIG.bash.sourceMode,
    },
    ui: {
      showRewriteNotifications:
        config?.ui?.showRewriteNotifications ??
        DEFAULT_EXTENSION_CONFIG.ui.showRewriteNotifications,
    },
  })
}

export function resolveRuntimeConfig(
  extensionConfig: ResolvedExtensionConfig,
  projectConfig: ProjectToolchainConfig = DEFAULT_PROJECT_TOOLCHAIN_CONFIG,
): ResolvedToolchainConfig {
  return validateResolvedConfig({
    enabled: extensionConfig.enabled,
    features: {
      enforcePackageManager: projectConfig.features.enforcePackageManager,
      rewritePython: projectConfig.features.rewritePython,
      gitRebaseEditor: extensionConfig.features.gitRebaseEditor,
    },
    packageManager: {
      selected:
        projectConfig.packageManager.selected ??
        DEFAULT_CONFIG.packageManager.selected,
    },
    bash: extensionConfig.bash,
    ui: extensionConfig.ui,
  })
}

/** @deprecated Use resolveExtensionConfig for JSON-backed settings or resolveRuntimeConfig for final runtime config. */
export function resolveToolchainConfig(
  config: ToolchainConfig | null | undefined,
): ResolvedExtensionConfig {
  return resolveExtensionConfig(config)
}

export const configLoader = new ConfigLoader<
  ToolchainConfig,
  ResolvedExtensionConfig
>('toolchain', DEFAULT_EXTENSION_CONFIG, {
  scopes: ['global', 'memory'],
  migrations,
  afterMerge: (_resolved, global, _local, memory) => {
    const merged = mergeToolchainConfigs(global, memory)
    queueIgnoredLegacyProjectSettingsWarning(merged)
    return resolveExtensionConfig(merged)
  },
})
