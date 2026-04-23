import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import { DynamicBorder, getAgentDir } from '@mariozechner/pi-coding-agent'
import {
  Container,
  Key,
  matchesKey,
  SelectList,
  Text,
} from '@mariozechner/pi-tui'
import { getProfileCompletions } from './completions'
import {
  getDefaultGlobalProfileRoot,
  getDefaultProjectProfileRoot,
  PROFILE_STATE_ENTRY_TYPE,
  PROFILES_COMMAND,
} from './constants'
import { loadProfileExtensionsIntoPi } from './extension-loader'
import {
  discoverProfiles,
  formatProfileRef,
  resolveProfileCreateTarget,
  resolveProfileRef,
} from './profile-discovery'
import { createProfileTemplate, readProfileSettings } from './profile-settings'
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

interface ProfilesDialogAction {
  type: 'cancel' | 'copy' | 'create' | 'edit' | 'select'
  value?: string
}

const NONE_PROFILE_VALUE = '__none__'

function isUnloadSelector(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    normalized === 'none' ||
    normalized === '(none)' ||
    normalized === 'off' ||
    normalized === 'unload'
  )
}

function quoteShellArgument(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replaceAll('"', '""')}"`
  }

  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function openInExternalEditor(targetPath: string): Promise<void> {
  const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim()

  if (!editor) {
    throw new Error('No external editor configured. Set VISUAL or EDITOR.')
  }

  const command = `${editor} ${quoteShellArgument(targetPath)}`
  const child =
    process.platform === 'win32'
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
          stdio: 'inherit',
        })
      : spawn(process.env.SHELL ?? '/bin/sh', ['-lc', command], {
          stdio: 'inherit',
        })

  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`External editor exited with signal ${signal}.`))
        return
      }

      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(`External editor exited with code ${code ?? 'unknown'}.`),
      )
    })
  })
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

      ctx.ui.setStatus(
        'profiles-load',
        `Loading ${formatProfileRef(serialized)}`,
      )
      ctx.ui.setWorkingMessage(
        `Loading profile "${formatProfileRef(serialized)}"...`,
      )

      let resolved: ResolvedProfileResources

      try {
        resolved = await resolveResourcesForRef(serialized, ctx.cwd)
      } catch (error) {
        ctx.ui.setStatus('profiles-load', undefined)
        ctx.ui.setWorkingMessage()
        throw error
      }

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
      ctx.ui.setStatus(
        'profiles-load',
        `Reloading ${formatProfileRef(serialized)}`,
      )
      ctx.ui.setWorkingMessage(
        `Reloading Pi with profile "${formatProfileRef(serialized)}"...`,
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
      ctx.ui.setStatus(
        'profiles-load',
        `Reloading without ${formatProfileRef(previous)}`,
      )
      ctx.ui.setWorkingMessage(
        `Reloading Pi without profile "${formatProfileRef(previous)}"...`,
      )
      ctx.ui.notify(
        `Unloaded profile "${formatProfileRef(previous)}". Reloading…`,
        'info',
      )
      await ctx.reload()
      return
    }

    async function createProfile(
      rawName: string,
      ctx: ExtensionCommandContext,
    ): Promise<ProfileRef | null> {
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
          return null
        }

        await mkdir(target.profileDir, { recursive: true })
        await writeFile(target.settingsPath, createProfileTemplate(), 'utf8')
        ctx.ui.notify(
          `Created profile "${formatProfileRef(target)}" at ${target.settingsPath}`,
          'info',
        )
        return target
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(message, 'error')
        return null
      }
    }

    async function copyProfile(
      source: ProfileRef,
      rawName: string,
      ctx: ExtensionCommandContext,
    ): Promise<ProfileRef | null> {
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
          return null
        }

        const settingsContents = await readFile(source.settingsPath, 'utf8')
        await mkdir(target.profileDir, { recursive: true })
        await writeFile(target.settingsPath, settingsContents, 'utf8')
        ctx.ui.notify(
          `Copied profile "${formatProfileRef(source)}" to "${formatProfileRef(target)}".`,
          'info',
        )
        return target
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(message, 'error')
        return null
      }
    }

    async function showProfilesDialog(
      ctx: ExtensionCommandContext,
      preferredSelection: string | null,
    ): Promise<ProfilesDialogAction> {
      const projectRoot = await getProjectRoot(ctx.cwd)
      const profiles = await discoverProfiles(ctx.cwd, {
        globalRoot,
        projectRoot,
      })
      const profileDescriptions = new Map(
        await Promise.all(
          profiles.map(async (profile) => {
            try {
              const loaded = await readProfileSettings(profile)
              const description = loaded.settings.description?.trim()

              return [
                formatProfileRef(profile),
                description || profile.settingsPath,
              ] as const
            } catch {
              return [formatProfileRef(profile), profile.settingsPath] as const
            }
          }),
        ),
      )

      return ctx.ui.custom<ProfilesDialogAction>((tui, theme, _kb, done) => {
        const items = [
          {
            value: NONE_PROFILE_VALUE,
            label: '(none)',
            description: activeProfileRef
              ? `Unload ${formatProfileRef(activeProfileRef)}`
              : 'No profile is active in this session',
          },
          ...profiles.map((profile) => {
            const value = formatProfileRef(profile)
            const isActive = sameProfile(
              activeProfileRef,
              asSerializedProfileRef(profile),
            )

            return {
              value,
              label: isActive ? `${value} (active)` : value,
              description:
                profileDescriptions.get(value) ?? profile.settingsPath,
            }
          }),
        ]

        const selectList = new SelectList(
          items,
          Math.min(Math.max(items.length, 3), 12),
          {
            selectedPrefix: (text) => theme.fg('accent', text),
            selectedText: (text) => theme.fg('accent', text),
            description: (text) => theme.fg('muted', text),
            scrollInfo: (text) => theme.fg('dim', text),
            noMatch: (text) => theme.fg('warning', text),
          },
        )

        if (preferredSelection) {
          const selectedIndex = items.findIndex(
            (item) => item.value === preferredSelection,
          )

          if (selectedIndex >= 0) {
            selectList.setSelectedIndex(selectedIndex)
          }
        }

        let completed = false

        selectList.onSelect = (item) => {
          completed = true
          done({ type: 'select', value: item.value })
        }
        selectList.onCancel = () => {
          completed = true
          done({ type: 'cancel' })
        }

        const container = new Container()
        container.addChild(
          new DynamicBorder((text) => theme.fg('accent', text)),
        )
        container.addChild(new Text(theme.fg('accent', theme.bold('Profiles'))))
        container.addChild(
          new Text(
            profiles.length > 0
              ? theme.fg(
                  'muted',
                  activeProfileRef
                    ? `Active: ${formatProfileRef(activeProfileRef)}`
                    : 'No active profile.',
                )
              : theme.fg('warning', 'No profiles found yet.'),
          ),
        )
        container.addChild(selectList)
        container.addChild(
          new Text(
            theme.fg(
              'dim',
              '↑↓ navigate • Enter load/unload • n new • c copy • e edit settings.json • Esc cancel',
            ),
          ),
        )
        container.addChild(
          new DynamicBorder((text) => theme.fg('accent', text)),
        )

        return {
          render(width: number) {
            return container.render(width)
          },
          invalidate() {
            container.invalidate()
          },
          handleInput(data: string) {
            const typedKey = data.length === 1 ? data.toLowerCase() : null

            if (typedKey === 'n') {
              done({ type: 'create' })
              return
            }

            if (typedKey === 'c') {
              done({
                type: 'copy',
                value: selectList.getSelectedItem()?.value,
              })
              return
            }

            if (typedKey === 'e') {
              done({
                type: 'edit',
                value: selectList.getSelectedItem()?.value,
              })
              return
            }

            if (matchesKey(data, Key.escape)) {
              done({ type: 'cancel' })
              return
            }

            selectList.handleInput(data)

            if (!completed) {
              tui.requestRender()
            }
          },
        }
      })
    }

    async function openProfilesUi(ctx: ExtensionCommandContext) {
      let preferredSelection = activeProfileRef
        ? formatProfileRef(activeProfileRef)
        : NONE_PROFILE_VALUE

      while (true) {
        const action = await showProfilesDialog(ctx, preferredSelection)

        if (!action || action.type === 'cancel') {
          return
        }

        if (action.type === 'create') {
          const rawName = await ctx.ui.input('New profile name', '')

          if (rawName === undefined) {
            continue
          }

          const created = await createProfile(rawName, ctx)

          if (created) {
            preferredSelection = formatProfileRef(created)
          }

          continue
        }

        if (action.type === 'copy') {
          if (!action.value || action.value === NONE_PROFILE_VALUE) {
            ctx.ui.notify('Select a profile to copy.', 'warning')
            continue
          }

          const projectRoot = await getProjectRoot(ctx.cwd)
          const ref = await resolveProfileRef(action.value, ctx.cwd, {
            globalRoot,
            projectRoot,
          })

          if (!ref) {
            ctx.ui.notify(`Profile "${action.value}" was not found.`, 'error')
            continue
          }

          const rawName = await ctx.ui.input(
            `Copy profile "${formatProfileRef(ref)}" as`,
            `${ref.scope}:${ref.name}-copy`,
          )

          if (rawName === undefined) {
            preferredSelection = action.value
            continue
          }

          const copied = await copyProfile(ref, rawName, ctx)

          if (copied) {
            preferredSelection = formatProfileRef(copied)
          } else {
            preferredSelection = action.value
          }

          continue
        }

        if (action.type === 'edit') {
          if (!action.value || action.value === NONE_PROFILE_VALUE) {
            ctx.ui.notify('Select a profile to edit.', 'warning')
            continue
          }

          const projectRoot = await getProjectRoot(ctx.cwd)
          const ref = await resolveProfileRef(action.value, ctx.cwd, {
            globalRoot,
            projectRoot,
          })

          if (!ref) {
            ctx.ui.notify(`Profile "${action.value}" was not found.`, 'error')
            continue
          }

          await openInExternalEditor(ref.settingsPath)
          preferredSelection = action.value
          continue
        }

        if (action.value === NONE_PROFILE_VALUE) {
          await unloadActiveProfile(ctx)
          return
        }

        const projectRoot = await getProjectRoot(ctx.cwd)
        const ref = await resolveProfileRef(action.value ?? '', ctx.cwd, {
          globalRoot,
          projectRoot,
        })

        if (!ref) {
          ctx.ui.notify(`Profile "${action.value}" was not found.`, 'error')
          preferredSelection = NONE_PROFILE_VALUE
          continue
        }

        await activateProfile(ref, ctx)
        return
      }
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

    ;(pi.on as (...args: unknown[]) => void)(
      'session_switch',
      async (_event: unknown, ctx: ExtensionContext) => {
        await syncProfileState(ctx)
      },
    )

    ;(pi.on as (...args: unknown[]) => void)(
      'session_fork',
      async (_event: unknown, ctx: ExtensionContext) => {
        await syncProfileState(ctx)
      },
    )

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

    pi.registerCommand(PROFILES_COMMAND, {
      description: 'Manage profiles for the current session',
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

        try {
          await updateActiveProfileFromContext(ctx)

          if (rawArg) {
            if (isUnloadSelector(rawArg)) {
              await unloadActiveProfile(ctx)
              return
            }

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

          if (!ctx.hasUI) {
            const projectRoot = await getProjectRoot(ctx.cwd)
            const profiles = await discoverProfiles(ctx.cwd, {
              globalRoot,
              projectRoot,
            })

            if (profiles.length === 0) {
              ctx.ui.notify('No profiles were found.', 'warning')
              return
            }

            const summary = profiles
              .map((profile) => formatProfileRef(profile))
              .join(', ')
            ctx.ui.notify(`Available profiles: ${summary}`, 'info')
            return
          }

          await openProfilesUi(ctx)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.ui.notify(message, 'error')
        }
      },
    })
  }
}

export default createPiProfiles()
