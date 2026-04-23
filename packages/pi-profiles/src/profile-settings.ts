import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PackageSource } from '@mariozechner/pi-coding-agent'
import { PROFILE_SETTINGS_FILE } from './constants'
import type {
  LoadedProfile,
  ProfileRef,
  ProfileSettings,
  ProfileSkillpackSelection,
} from './types'

const URL_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStringArray(
  value: unknown,
  fieldName: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(
      `${PROFILE_SETTINGS_FILE}: "${fieldName}" must be an array of strings.`,
    )
  }

  return value
}

function normalizeOptionalString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(
      `${PROFILE_SETTINGS_FILE}: "${fieldName}" must be a string.`,
    )
  }

  return value
}

function normalizeSkillpacks(
  value: unknown,
): Array<string | ProfileSkillpackSelection> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error(`${PROFILE_SETTINGS_FILE}: "skillpacks" must be an array.`)
  }

  return value.map((entry, index) => {
    if (typeof entry === 'string') {
      return entry
    }

    if (!isObject(entry) || typeof entry.path !== 'string') {
      throw new Error(
        `${PROFILE_SETTINGS_FILE}: "skillpacks[${index}]" must be a string or an object with a string "path" field.`,
      )
    }

    if (
      entry.skills !== undefined &&
      (!Array.isArray(entry.skills) ||
        entry.skills.some((skill) => typeof skill !== 'string'))
    ) {
      throw new Error(
        `${PROFILE_SETTINGS_FILE}: "skillpacks[${index}].skills" must be an array of strings.`,
      )
    }

    return {
      path: entry.path,
      skills: entry.skills as string[] | undefined,
    }
  })
}

function normalizePackages(value: unknown): PackageSource[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value)) {
    throw new Error(`${PROFILE_SETTINGS_FILE}: "packages" must be an array.`)
  }

  return value.map((entry, index) => {
    if (typeof entry === 'string') {
      return entry
    }

    if (!isObject(entry) || typeof entry.source !== 'string') {
      throw new Error(
        `${PROFILE_SETTINGS_FILE}: "packages[${index}]" must be a string or an object with a string "source" field.`,
      )
    }

    const normalized: Exclude<PackageSource, string> = {
      source: entry.source,
    }

    for (const fieldName of [
      'extensions',
      'skills',
      'prompts',
      'themes',
    ] as const) {
      const fieldValue = entry[fieldName]

      if (fieldValue === undefined) {
        continue
      }

      if (
        !Array.isArray(fieldValue) ||
        fieldValue.some((resource) => typeof resource !== 'string')
      ) {
        throw new Error(
          `${PROFILE_SETTINGS_FILE}: "packages[${index}].${fieldName}" must be an array of strings.`,
        )
      }

      normalized[fieldName] = fieldValue
    }

    return normalized
  })
}

export async function readProfileSettings(
  ref: ProfileRef,
): Promise<LoadedProfile> {
  let contents: string

  try {
    contents = await readFile(ref.settingsPath, 'utf8')
  } catch (error) {
    const errno = error as NodeJS.ErrnoException

    if (errno.code === 'ENOENT') {
      throw new Error(
        `Profile "${ref.name}" is missing ${PROFILE_SETTINGS_FILE}.`,
      )
    }

    throw error
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Invalid ${PROFILE_SETTINGS_FILE} for profile "${ref.name}": ${message}`,
    )
  }

  if (!isObject(parsed)) {
    throw new Error(
      `${PROFILE_SETTINGS_FILE} for profile "${ref.name}" must contain a JSON object.`,
    )
  }

  const settings: ProfileSettings = {
    ...parsed,
    description: normalizeOptionalString(parsed.description, 'description'),
    packages: normalizePackages(parsed.packages),
    extensions: normalizeStringArray(parsed.extensions, 'extensions'),
    skills: normalizeStringArray(parsed.skills, 'skills'),
    prompts: normalizeStringArray(parsed.prompts, 'prompts'),
    themes: normalizeStringArray(parsed.themes, 'themes'),
    skillpacks: normalizeSkillpacks(parsed.skillpacks),
  }

  return {
    ref,
    settings,
  }
}

function splitSpecifierPrefix(value: string): { prefix: string; body: string } {
  if (value.startsWith('!') || value.startsWith('+') || value.startsWith('-')) {
    return {
      prefix: value[0] ?? '',
      body: value.slice(1),
    }
  }

  return {
    prefix: '',
    body: value,
  }
}

function resolveSpecialPath(body: string, profileDir: string): string {
  const trimmed = body.trim()

  if (!trimmed) {
    return trimmed
  }

  if (trimmed === '~' || trimmed.startsWith('~/')) {
    return trimmed
  }

  if (WINDOWS_ABSOLUTE_PATH.test(trimmed) || URL_PREFIX.test(trimmed)) {
    return trimmed
  }

  if (trimmed.startsWith('/')) {
    return trimmed
  }

  return resolve(profileDir, trimmed)
}

export function resolveProfileResourceSpecifiers(
  profileDir: string,
  entries: string[] | undefined,
): string[] {
  if (!entries || entries.length === 0) {
    return []
  }

  return entries.map((entry) => {
    const { prefix, body } = splitSpecifierPrefix(entry)
    return `${prefix}${resolveSpecialPath(body, profileDir)}`
  })
}

export function resolveProfilePackageSources(
  profileDir: string,
  packages: PackageSource[] | undefined,
): PackageSource[] {
  if (!packages || packages.length === 0) {
    return []
  }

  return packages.map((entry) => {
    if (typeof entry === 'string') {
      return resolveSpecialPath(entry, profileDir)
    }

    return {
      ...entry,
      source: resolveSpecialPath(entry.source, profileDir),
    }
  })
}

export function createProfileTemplate(): string {
  return `${JSON.stringify(
    {
      description: '',
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
      skillpacks: [],
      defaultThinkingLevel: 'medium',
    },
    null,
    2,
  )}\n`
}
