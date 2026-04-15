import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import {
  getDefaultGlobalProfileRoot,
  getDefaultProjectProfileRoot,
  PROFILE_SETTINGS_FILE,
} from './constants'
import type { ProfileRef, ProfileScope, SerializedProfileRef } from './types'

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const SCOPE_PREFIX = /^(project|user):(.*)$/

export interface NormalizedProfileSelector {
  scope?: ProfileScope
  name: string
}

function normalizeRelativePath(input: string): string {
  const trimmed = input.trim().replaceAll('\\', '/')

  if (!trimmed) {
    throw new Error('Profile name is required.')
  }

  if (
    trimmed.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH.test(trimmed) ||
    isAbsolute(trimmed)
  ) {
    throw new Error('Profile name must be relative.')
  }

  const parts = trimmed
    .split('/')
    .filter((part) => part.length > 0 && part !== '.')

  if (parts.length === 0) {
    throw new Error('Profile name is required.')
  }

  if (parts.some((part) => part === '..')) {
    throw new Error("Profile name cannot contain '..' segments.")
  }

  return parts.join('/')
}

export function normalizeProfileSelector(
  input: string,
): NormalizedProfileSelector {
  const trimmed = input.trim()

  if (!trimmed) {
    throw new Error('Profile name is required.')
  }

  const scopedMatch = trimmed.match(SCOPE_PREFIX)

  if (!scopedMatch) {
    return {
      name: normalizeRelativePath(trimmed),
    }
  }

  const [, rawScope, rawName] = scopedMatch

  return {
    scope: rawScope as ProfileScope,
    name: normalizeRelativePath(rawName),
  }
}

export function formatProfileRef(ref: SerializedProfileRef): string {
  return `${ref.scope}:${ref.name}`
}

async function scanProfileRoot(
  rootDir: string,
  scope: ProfileScope,
  relativeDir = '',
): Promise<ProfileRef[]> {
  let entries: Awaited<ReturnType<typeof readdir>>

  try {
    entries = await readdir(join(rootDir, relativeDir), { withFileTypes: true })
  } catch (error) {
    const errno = error as NodeJS.ErrnoException

    if (errno.code === 'ENOENT') {
      return []
    }

    throw error
  }

  const profileDir = join(rootDir, relativeDir)
  const settingsPath = join(profileDir, PROFILE_SETTINGS_FILE)

  if (existsSync(settingsPath)) {
    return [
      {
        scope,
        name: relativeDir,
        rootDir,
        profileDir,
        settingsPath,
      },
    ]
  }

  const childDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const nestedProfiles = await Promise.all(
    childDirs.map((child) =>
      scanProfileRoot(
        rootDir,
        scope,
        relativeDir ? `${relativeDir}/${child}` : child,
      ),
    ),
  )

  return nestedProfiles.flat()
}

export async function discoverProfiles(
  cwd: string,
  options: {
    globalRoot?: string
    projectRoot?: string
  } = {},
): Promise<ProfileRef[]> {
  const projectRoot = options.projectRoot ?? getDefaultProjectProfileRoot(cwd)
  const globalRoot = options.globalRoot ?? getDefaultGlobalProfileRoot()

  const [projectProfiles, globalProfiles] = await Promise.all([
    scanProfileRoot(projectRoot, 'project'),
    scanProfileRoot(globalRoot, 'user'),
  ])

  return [...projectProfiles, ...globalProfiles].sort((left, right) => {
    if (left.name === right.name) {
      return left.scope.localeCompare(right.scope)
    }

    return left.name.localeCompare(right.name)
  })
}

export async function resolveProfileRef(
  selector: string | SerializedProfileRef,
  cwd: string,
  options: {
    globalRoot?: string
    projectRoot?: string
  } = {},
): Promise<ProfileRef | null> {
  const normalized =
    typeof selector === 'string'
      ? normalizeProfileSelector(selector)
      : {
          scope: selector.scope,
          name: normalizeRelativePath(selector.name),
        }

  const profiles = await discoverProfiles(cwd, options)

  if (normalized.scope) {
    return (
      profiles.find(
        (profile) =>
          profile.scope === normalized.scope &&
          profile.name === normalized.name,
      ) ?? null
    )
  }

  return profiles.find((profile) => profile.name === normalized.name) ?? null
}

export function resolveProfileCreateTarget(
  selector: string,
  cwd: string,
  options: {
    globalRoot?: string
    projectRoot?: string
  } = {},
): ProfileRef {
  const normalized = normalizeProfileSelector(selector)
  const scope = normalized.scope ?? 'user'
  const rootDir =
    scope === 'project'
      ? (options.projectRoot ?? getDefaultProjectProfileRoot(cwd))
      : (options.globalRoot ?? getDefaultGlobalProfileRoot())
  const profileDir = resolve(rootDir, normalized.name)

  return {
    scope,
    name: normalized.name,
    rootDir,
    profileDir,
    settingsPath: join(profileDir, PROFILE_SETTINGS_FILE),
  }
}
