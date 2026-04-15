import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import { getAgentDir } from '@mariozechner/pi-coding-agent'
import {
  getActiveProfileCompletion,
  getProfileCompletions,
} from './completions'
import {
  getDefaultGlobalProfileRoot,
  getDefaultProjectProfileRoot,
  PROFILE_CREATE_COMMAND,
  PROFILE_LOAD_COMMAND,
  PROFILE_STATE_ENTRY_TYPE,
  PROFILE_UNLOAD_COMMAND,
  PROFILES_COMMAND,
} from './constants'
import { loadProfileExtensionsIntoPi } from './extension-loader'
import {
  discoverProfiles,
  formatProfileRef,
  resolveProfileCreateTarget,
  resolveProfileRef,
} from './profile-discovery'
import { createProfileTemplate } from './profile-settings'
import { resolveProfileResources } from './resource-resolution'
import {
  clearRuntimeProfileProcessState,
  resolveBootstrapProfileRef,
  updateRuntimeProfileCache,
} from './runtime-cache'
import { applyProfileRuntimeSettings } from './runtime-settings'
import {
  installSettingsManagerProfileOverlay,
  setSettingsManagerProfileOverlay,
} from './settings-overlay'
import { getDefaultSkillpackRoot } from './skillpacks'
import {
  createProfileState,
  restoreActiveProfileFromEntries,
  type SessionEntryLike,
} from './state'
import type {
  LoadedProfile,
  ProfileRef,
  ResolvedProfileResources,
  SerializedProfileRef,
} from './types'

interface PiProfilesOptions {
  agentDir?: string
  globalRoot?: string
  projectRoot?: string
  skillpackRoot?: string
}

function profileCacheKey(ref: SerializedProfileRef): string {
  return `${ref.scope}:${ref.name}`
}

function asSerializedProfileRef(ref: ProfileRef): SerializedProfileRef {
  return {
    scope: ref.scope,
    name: ref.name,
  }
}

function sameProfile(
  left: SerializedProfileRef | null,
  right: SerializedProfileRef | null,
): boolean {
  if (!left && !right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.scope === right.scope && left.name === right.name
}

export function createPiProfiles(options: PiProfilesOptions = {}) {
  installSettingsManagerProfileOverlay()

  const agentDir = options.agentDir ?? getAgentDir()
  const globalRoot = options.globalRoot ?? getDefaultGlobalProfileRoot(agentDir)
  const skillpackRoot = options.skillpackRoot ?? getDefaultSkillpackRoot()
  const resourceCache = new Map<string, Promise<ResolvedProfileResources>>()
  const loadedExtensionPaths = new Set<string>()
  const notifications = new Set<string>()

  return async function piProfiles(pi: ExtensionAPI) {
    let activeProfileRef: SerializedProfileRef | null = null
    let activeProfile: LoadedProfile | null = null
    let bootstrapError: string | null = null

    async function getProjectRoot(cwd: string): Promise<string> {
      return options.projectRoot ?? getDefaultProjectProfileRoot(cwd)
    }

    async function resolveResourcesForRef(
      ref: SerializedProfileRef,
      cwd: string,
    ): Promise<ResolvedProfileResources> {
      const key = profileCacheKey(ref)
      const cached = resourceCache.get(key)

      if (cached) {
        return cached
      }

      const promise = (async () => {
        const projectRoot = await getProjectRoot(cwd)
        const resolvedRef = await resolveProfileRef(ref, cwd, {
          globalRoot,
          projectRoot,
        })

        if (!resolvedRef) {
          throw new Error(`Profile "${formatProfileRef(ref)}" was not found.`)
        }

        return resolveProfileResources(resolvedRef, {
          cwd,
          agentDir,
          skillpackRoot,
        })
      })().catch((error) => {
        resourceCache.delete(key)
        throw error
      })

      resourceCache.set(key, promise)
      return promise
    }

    async function updateActiveProfileFromContext(ctx: ExtensionContext) {
      const restored = restoreActiveProfileFromEntries(
        ctx.sessionManager.getBranch() as SessionEntryLike[],
      )

      activeProfileRef = restored ?? null

      if (!activeProfileRef) {
        activeProfile = null
        setSettingsManagerProfileOverlay(null)
        await updateRuntimeProfileCache(
          {
            cwd: ctx.cwd,
            sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
            activeProfile: null,
          },
          agentDir,
        )
        return
      }

      try {
        const resolved = await resolveResourcesForRef(activeProfileRef, ctx.cwd)
        activeProfile = resolved.profile
        setSettingsManagerProfileOverlay(activeProfile)
        await updateRuntimeProfileCache(
          {
            cwd: ctx.cwd,
            sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
            activeProfile: activeProfileRef,
          },
          agentDir,
        )
      } catch (error) {
        activeProfile = null
        setSettingsManagerProfileOverlay(null)
        throw error
      }
    }

    async function ensureActiveProfileExtensionsLoaded(cwd: string) {
      if (!activeProfileRef) {
        return
      }

      const resolved = await resolveResourcesForRef(activeProfileRef, cwd)
      activeProfile = resolved.profile
      setSettingsManagerProfileOverlay(activeProfile)
      await loadProfileExtensionsIntoPi(
        pi,
        resolved.extensionPaths,
        loadedExtensionPaths,
      )
    }

    function persistActiveProfile(active: SerializedProfileRef | null) {
      pi.appendEntry(PROFILE_STATE_ENTRY_TYPE, createProfileState(active))
    }

    async function activateProfile(
      ref: ProfileRef,
      ctx: ExtensionCommandContext,
    ) {
      const serialized = asSerializedProfileRef(ref)

      if (sameProfile(activeProfileRef, serialized)) {
        ctx.ui.notify(
          `Profile "${formatProfileRef(serialized)}" is already active.`,
          'info',
        )
        return
      }

      const resolved = await resolveResourcesForRef(serialized, ctx.cwd)
      persistActiveProfile(serialized)
      activeProfileRef = serialized
      activeProfile = resolved.profile
      setSettingsManagerProfileOverlay(activeProfile)
      await updateRuntimeProfileCache(
        {
          cwd: ctx.cwd,
          sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
          activeProfile: serialized,
        },
        agentDir,
      )
      ctx.ui.notify(
        `Loaded profile "${formatProfileRef(serialized)}". Reloading…`,
        'info',
      )
      await ctx.reload()
      return
    }

    async function unloadActiveProfile(ctx: ExtensionCommandContext) {
      if (!activeProfileRef) {
        ctx.ui.notify('No profile is active in this session.', 'info')
        return
      }

      const previous = activeProfileRef
      persistActiveProfile(null)
      activeProfileRef = null
      activeProfile = null
      setSettingsManagerProfileOverlay(null)
      await updateRuntimeProfileCache(
        {
          cwd: ctx.cwd,
          sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
          activeProfile: null,
        },
        agentDir,
      )
      ctx.ui.notify(
        `Unloaded profile "${formatProfileRef(previous)}". Reloading…`,
        'info',
      )
      await ctx.reload()
      return
    }

    async function syncProfileState(ctx: ExtensionContext) {
      try {
        await updateActiveProfileFromContext(ctx)
        await ensureActiveProfileExtensionsLoaded(ctx.cwd)
      } catch (error) {
        setSettingsManagerProfileOverlay(null)
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(message, 'error')
      }

      await applyProfileRuntimeSettings(pi, ctx, activeProfile, notifications)
    }

    const bootstrapProfileRef = await resolveBootstrapProfileRef(
      process.cwd(),
      agentDir,
    )

    if (bootstrapProfileRef) {
      activeProfileRef = bootstrapProfileRef

      try {
        const resolved = await resolveResourcesForRef(
          bootstrapProfileRef,
          process.cwd(),
        )
        activeProfile = resolved.profile
        setSettingsManagerProfileOverlay(activeProfile)
        await loadProfileExtensionsIntoPi(
          pi,
          resolved.extensionPaths,
          loadedExtensionPaths,
        )
      } catch (error) {
        bootstrapError = error instanceof Error ? error.message : String(error)
      }
    }

    pi.on('session_start', async (_event, ctx) => {
      if (bootstrapError) {
        ctx.ui.notify(bootstrapError, 'error')
        bootstrapError = null
      }

      await syncProfileState(ctx)
    })

    pi.on('session_tree', async (_event, ctx) => {
      await syncProfileState(ctx)
    })

    pi.on('session_switch', async (_event, ctx) => {
      await syncProfileState(ctx)
    })

    pi.on('session_fork', async (_event, ctx) => {
      await syncProfileState(ctx)
    })

    pi.on('session_shutdown', async () => {
      setSettingsManagerProfileOverlay(null)
      await clearRuntimeProfileProcessState(agentDir)
    })

    pi.on('resources_discover', async (_event, ctx) => {
      try {
        await updateActiveProfileFromContext(ctx)
      } catch {
        setSettingsManagerProfileOverlay(null)
        return undefined
      }

      if (!activeProfileRef) {
        return undefined
      }

      const resolved = await resolveResourcesForRef(activeProfileRef, ctx.cwd)
      activeProfile = resolved.profile
      setSettingsManagerProfileOverlay(activeProfile)

      return {
        skillPaths: resolved.skillPaths,
        promptPaths: resolved.promptPaths,
        themePaths: resolved.themePaths,
      }
    })

    pi.registerCommand(PROFILE_CREATE_COMMAND, {
      description: 'Create a new Pi profile settings directory',
      handler: async (args, ctx) => {
        const rawName = args.trim()

        if (!rawName) {
          ctx.ui.notify(`Usage: /${PROFILE_CREATE_COMMAND} <name>`, 'warning')
          return
        }

        try {
          const projectRoot = await getProjectRoot(ctx.cwd)
          const target = resolveProfileCreateTarget(rawName, ctx.cwd, {
            globalRoot,
            projectRoot,
          })

          if (existsSync(target.settingsPath)) {
            ctx.ui.notify(
              `Profile "${formatProfileRef(target)}" already exists.`,
              'warning',
            )
            return
          }

          await mkdir(target.profileDir, { recursive: true })
          await writeFile(target.settingsPath, createProfileTemplate(), 'utf8')
          ctx.ui.notify(
            `Created profile "${formatProfileRef(target)}" at ${target.settingsPath}`,
            'info',
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.ui.notify(message, 'error')
        }
      },
    })

    pi.registerCommand(PROFILE_LOAD_COMMAND, {
      description: 'Load a profile into the current session and reload',
      getArgumentCompletions: ((prefix) =>
        getProfileCompletions(process.cwd(), prefix) as unknown as Array<{
          value: string
          label: string
          description?: string
        }> | null) as (
        argumentPrefix: string,
      ) => Array<{ value: string; label: string; description?: string }> | null,
      handler: async (args, ctx) => {
        const rawName = args.trim()

        if (!rawName) {
          ctx.ui.notify(`Usage: /${PROFILE_LOAD_COMMAND} <name>`, 'warning')
          return
        }

        try {
          const projectRoot = await getProjectRoot(ctx.cwd)
          const ref = await resolveProfileRef(rawName, ctx.cwd, {
            globalRoot,
            projectRoot,
          })

          if (!ref) {
            ctx.ui.notify(`Profile "${rawName}" was not found.`, 'error')
            return
          }

          await activateProfile(ref, ctx)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.ui.notify(message, 'error')
        }
      },
    })

    pi.registerCommand(PROFILE_UNLOAD_COMMAND, {
      description: 'Unload the current session profile and reload',
      getArgumentCompletions: (prefix) =>
        getActiveProfileCompletion(activeProfileRef, prefix),
      handler: async (_args, ctx) => {
        try {
          await unloadActiveProfile(ctx)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.ui.notify(message, 'error')
        }
      },
    })

    pi.registerCommand(PROFILES_COMMAND, {
      description: 'Select or load a profile for the current session',
      getArgumentCompletions: ((prefix) =>
        getProfileCompletions(process.cwd(), prefix) as unknown as Array<{
          value: string
          label: string
          description?: string
        }> | null) as (
        argumentPrefix: string,
      ) => Array<{ value: string; label: string; description?: string }> | null,
      handler: async (args, ctx) => {
        const rawArg = args.trim()

        if (rawArg) {
          const projectRoot = await getProjectRoot(ctx.cwd)
          const ref = await resolveProfileRef(rawArg, ctx.cwd, {
            globalRoot,
            projectRoot,
          })

          if (!ref) {
            ctx.ui.notify(`Profile "${rawArg}" was not found.`, 'error')
            return
          }

          await activateProfile(ref, ctx)
          return
        }

        const projectRoot = await getProjectRoot(ctx.cwd)
        const profiles = await discoverProfiles(ctx.cwd, {
          globalRoot,
          projectRoot,
        })

        if (profiles.length === 0) {
          ctx.ui.notify('No profiles were found.', 'warning')
          return
        }

        if (!ctx.hasUI) {
          const summary = profiles
            .map((profile) => formatProfileRef(profile))
            .join(', ')
          ctx.ui.notify(`Available profiles: ${summary}`, 'info')
          return
        }

        const noneOption = '(none)'
        const choices = [
          noneOption,
          ...profiles.map((profile) => formatProfileRef(profile)),
        ]
        const selection = await ctx.ui.select('Select profile', choices)

        if (!selection) {
          return
        }

        if (selection === noneOption) {
          await unloadActiveProfile(ctx)
          return
        }

        const ref = await resolveProfileRef(selection, ctx.cwd, {
          globalRoot,
          projectRoot,
        })

        if (!ref) {
          ctx.ui.notify(`Profile "${selection}" was not found.`, 'error')
          return
        }

        await activateProfile(ref, ctx)
      },
    })
  }
}

export default createPiProfiles()
