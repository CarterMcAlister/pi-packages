import { SettingsManager } from '@mariozechner/pi-coding-agent'
import {
  resolveProfilePackageSources,
  resolveProfileResourceSpecifiers,
} from './profile-settings'
import type { LoadedProfile, ProfileSettings } from './types'

interface EffectiveSettingsState {
  globalSettings: Record<string, unknown>
  projectSettings: Record<string, unknown>
  settings: Record<string, unknown>
}

const ADDITIVE_ARRAY_KEYS = new Set([
  'packages',
  'extensions',
  'skills',
  'prompts',
  'themes',
  'skillpacks',
  'mcps',
])

let activeOverlaySettings: ProfileSettings | null = null
let settingsOverlayInstalled = false

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function dedupeArray(values: unknown[]): unknown[] {
  const seen = new Set<string>()
  const result: unknown[] = []

  for (const value of values) {
    const key = JSON.stringify(value)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(value)
  }

  return result
}

function mergeProfileIntoProjectSettings(
  baseProjectSettings: Record<string, unknown>,
  overlay: ProfileSettings,
): Record<string, unknown> {
  const merged = clone(baseProjectSettings)

  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) {
      continue
    }

    const currentValue = merged[key]

    if (ADDITIVE_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      merged[key] = dedupeArray([
        ...(Array.isArray(currentValue) ? currentValue : []),
        ...value,
      ])
      continue
    }

    if (isObject(currentValue) && isObject(value)) {
      merged[key] = mergeProfileIntoProjectSettings(currentValue, value)
      continue
    }

    merged[key] = clone(value)
  }

  return merged
}

function deepMergeSettings(
  globalSettings: Record<string, unknown>,
  projectSettings: Record<string, unknown>,
): Record<string, unknown> {
  const merged = clone(globalSettings)

  for (const [key, value] of Object.entries(projectSettings)) {
    const currentValue = merged[key]

    if (isObject(currentValue) && isObject(value)) {
      merged[key] = deepMergeSettings(currentValue, value)
      continue
    }

    merged[key] = clone(value)
  }

  return merged
}

function buildEffectiveSettingsState(
  manager: SettingsManager,
): EffectiveSettingsState {
  const globalSettings = clone(
    (manager as unknown as { globalSettings?: Record<string, unknown> })
      .globalSettings ?? {},
  )
  const baseProjectSettings = clone(
    (manager as unknown as { projectSettings?: Record<string, unknown> })
      .projectSettings ?? {},
  )
  const projectSettings = activeOverlaySettings
    ? mergeProfileIntoProjectSettings(
        baseProjectSettings,
        activeOverlaySettings,
      )
    : baseProjectSettings

  return {
    globalSettings,
    projectSettings,
    settings: deepMergeSettings(globalSettings, projectSettings),
  }
}

function installSimpleGetter<T>(
  prototype: Record<string, unknown>,
  name: string,
  getter: (settings: Record<string, unknown>) => T,
): void {
  prototype[name] = function (this: SettingsManager): T {
    return getter(buildEffectiveSettingsState(this).settings)
  }
}

function mergeLayeredArray<T>(state: EffectiveSettingsState, key: string): T[] {
  return dedupeArray([
    ...(((state.globalSettings[key] as T[] | undefined) ?? []) as T[]),
    ...(((state.projectSettings[key] as T[] | undefined) ?? []) as T[]),
  ]) as T[]
}

export function installSettingsManagerProfileOverlay(): void {
  if (settingsOverlayInstalled) {
    return
  }

  settingsOverlayInstalled = true
  const prototype = SettingsManager.prototype as unknown as Record<
    string,
    unknown
  >

  prototype.getGlobalSettings = function (this: SettingsManager) {
    return clone(buildEffectiveSettingsState(this).globalSettings)
  }

  prototype.getProjectSettings = function (this: SettingsManager) {
    return clone(buildEffectiveSettingsState(this).projectSettings)
  }

  installSimpleGetter(
    prototype,
    'getSessionDir',
    (settings) => settings.sessionDir,
  )
  installSimpleGetter(
    prototype,
    'getDefaultProvider',
    (settings) => settings.defaultProvider,
  )
  installSimpleGetter(
    prototype,
    'getDefaultModel',
    (settings) => settings.defaultModel,
  )
  installSimpleGetter(
    prototype,
    'getSteeringMode',
    (settings) => settings.steeringMode ?? 'one-at-a-time',
  )
  installSimpleGetter(
    prototype,
    'getFollowUpMode',
    (settings) => settings.followUpMode ?? 'one-at-a-time',
  )
  installSimpleGetter(prototype, 'getTheme', (settings) => settings.theme)
  installSimpleGetter(
    prototype,
    'getDefaultThinkingLevel',
    (settings) => settings.defaultThinkingLevel,
  )
  installSimpleGetter(
    prototype,
    'getTransport',
    (settings) => settings.transport ?? 'sse',
  )
  installSimpleGetter(
    prototype,
    'getCompactionEnabled',
    (settings) =>
      (settings.compaction as Record<string, unknown> | undefined)?.enabled ??
      true,
  )
  installSimpleGetter(
    prototype,
    'getCompactionReserveTokens',
    (settings) =>
      (settings.compaction as Record<string, unknown> | undefined)
        ?.reserveTokens ?? 16384,
  )
  installSimpleGetter(
    prototype,
    'getCompactionKeepRecentTokens',
    (settings) =>
      (settings.compaction as Record<string, unknown> | undefined)
        ?.keepRecentTokens ?? 20000,
  )
  prototype.getCompactionSettings = function (this: SettingsManager) {
    const settings = buildEffectiveSettingsState(this).settings
    const compaction = settings.compaction as
      | Record<string, unknown>
      | undefined

    return {
      enabled: compaction?.enabled ?? true,
      reserveTokens: compaction?.reserveTokens ?? 16384,
      keepRecentTokens: compaction?.keepRecentTokens ?? 20000,
    }
  }
  prototype.getBranchSummarySettings = function (this: SettingsManager) {
    const settings = buildEffectiveSettingsState(this).settings
    const branchSummary = settings.branchSummary as
      | Record<string, unknown>
      | undefined

    return {
      reserveTokens: branchSummary?.reserveTokens ?? 16384,
      skipPrompt: branchSummary?.skipPrompt ?? false,
    }
  }
  installSimpleGetter(
    prototype,
    'getBranchSummarySkipPrompt',
    (settings) =>
      (settings.branchSummary as Record<string, unknown> | undefined)
        ?.skipPrompt ?? false,
  )
  installSimpleGetter(
    prototype,
    'getRetryEnabled',
    (settings) =>
      (settings.retry as Record<string, unknown> | undefined)?.enabled ?? true,
  )
  prototype.getRetrySettings = function (this: SettingsManager) {
    const settings = buildEffectiveSettingsState(this).settings
    const retry = settings.retry as Record<string, unknown> | undefined

    return {
      enabled: retry?.enabled ?? true,
      maxRetries: retry?.maxRetries ?? 3,
      baseDelayMs: retry?.baseDelayMs ?? 2000,
      maxDelayMs: retry?.maxDelayMs ?? 60000,
    }
  }
  installSimpleGetter(
    prototype,
    'getHideThinkingBlock',
    (settings) => settings.hideThinkingBlock ?? false,
  )
  installSimpleGetter(
    prototype,
    'getShellPath',
    (settings) => settings.shellPath,
  )
  installSimpleGetter(
    prototype,
    'getQuietStartup',
    (settings) => settings.quietStartup ?? false,
  )
  installSimpleGetter(
    prototype,
    'getShellCommandPrefix',
    (settings) => settings.shellCommandPrefix,
  )
  installSimpleGetter(prototype, 'getNpmCommand', (settings) => {
    const npmCommand = settings.npmCommand
    return Array.isArray(npmCommand) ? [...npmCommand] : undefined
  })
  installSimpleGetter(
    prototype,
    'getCollapseChangelog',
    (settings) => settings.collapseChangelog ?? false,
  )
  prototype.getPackages = function (this: SettingsManager) {
    return mergeLayeredArray<unknown>(
      buildEffectiveSettingsState(this),
      'packages',
    )
  }
  prototype.getExtensionPaths = function (this: SettingsManager) {
    return mergeLayeredArray<string>(
      buildEffectiveSettingsState(this),
      'extensions',
    )
  }
  prototype.getSkillPaths = function (this: SettingsManager) {
    return mergeLayeredArray<string>(
      buildEffectiveSettingsState(this),
      'skills',
    )
  }
  prototype.getPromptTemplatePaths = function (this: SettingsManager) {
    return mergeLayeredArray<string>(
      buildEffectiveSettingsState(this),
      'prompts',
    )
  }
  prototype.getThemePaths = function (this: SettingsManager) {
    return mergeLayeredArray<string>(
      buildEffectiveSettingsState(this),
      'themes',
    )
  }
  installSimpleGetter(
    prototype,
    'getEnableSkillCommands',
    (settings) => settings.enableSkillCommands ?? true,
  )
  installSimpleGetter(
    prototype,
    'getThinkingBudgets',
    (settings) => settings.thinkingBudgets,
  )
  installSimpleGetter(
    prototype,
    'getShowImages',
    (settings) =>
      (settings.terminal as Record<string, unknown> | undefined)?.showImages ??
      true,
  )
  installSimpleGetter(prototype, 'getClearOnShrink', (settings) => {
    const terminal = settings.terminal as Record<string, unknown> | undefined

    if (terminal?.clearOnShrink !== undefined) {
      return terminal.clearOnShrink
    }

    return process.env.PI_CLEAR_ON_SHRINK === '1'
  })
  installSimpleGetter(
    prototype,
    'getImageAutoResize',
    (settings) =>
      (settings.images as Record<string, unknown> | undefined)?.autoResize ??
      true,
  )
  installSimpleGetter(
    prototype,
    'getBlockImages',
    (settings) =>
      (settings.images as Record<string, unknown> | undefined)?.blockImages ??
      false,
  )
  installSimpleGetter(
    prototype,
    'getEnabledModels',
    (settings) => settings.enabledModels,
  )
  installSimpleGetter(
    prototype,
    'getDoubleEscapeAction',
    (settings) => settings.doubleEscapeAction ?? 'tree',
  )
  installSimpleGetter(prototype, 'getTreeFilterMode', (settings) => {
    const mode = settings.treeFilterMode
    const validModes = new Set([
      'default',
      'no-tools',
      'user-only',
      'labeled-only',
      'all',
    ])

    return typeof mode === 'string' && validModes.has(mode) ? mode : 'default'
  })
  installSimpleGetter(prototype, 'getShowHardwareCursor', (settings) => {
    if (settings.showHardwareCursor !== undefined) {
      return settings.showHardwareCursor
    }

    return process.env.PI_HARDWARE_CURSOR === '1'
  })
  installSimpleGetter(
    prototype,
    'getEditorPaddingX',
    (settings) => settings.editorPaddingX ?? 0,
  )
  installSimpleGetter(
    prototype,
    'getAutocompleteMaxVisible',
    (settings) => settings.autocompleteMaxVisible ?? 5,
  )
  installSimpleGetter(
    prototype,
    'getCodeBlockIndent',
    (settings) =>
      (settings.markdown as Record<string, unknown> | undefined)
        ?.codeBlockIndent ?? '  ',
  )
}

export function setSettingsManagerProfileOverlay(
  profile: LoadedProfile | null,
): void {
  if (!profile) {
    activeOverlaySettings = null
    return
  }

  activeOverlaySettings = {
    ...clone(profile.settings),
    packages: resolveProfilePackageSources(
      profile.ref.profileDir,
      profile.settings.packages,
    ),
    extensions: resolveProfileResourceSpecifiers(
      profile.ref.profileDir,
      profile.settings.extensions,
    ),
    skills: resolveProfileResourceSpecifiers(
      profile.ref.profileDir,
      profile.settings.skills,
    ),
    prompts: resolveProfileResourceSpecifiers(
      profile.ref.profileDir,
      profile.settings.prompts,
    ),
    themes: resolveProfileResourceSpecifiers(
      profile.ref.profileDir,
      profile.settings.themes,
    ),
  }
}
