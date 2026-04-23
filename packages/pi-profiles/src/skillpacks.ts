import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { ProfileSkillpackSelection } from './types'

const SKILL_FILE_NAME = 'SKILL.md'
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/

export function getDefaultSkillpackRoot(): string {
  return join(homedir(), '.pi', 'agent', 'skillpacks')
}

export function normalizeSkillpackPath(input: string): string {
  const trimmed = input.trim().replaceAll('\\', '/')

  if (!trimmed) {
    throw new Error('Skillpack path is required.')
  }

  if (
    trimmed.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH.test(trimmed) ||
    isAbsolute(trimmed)
  ) {
    throw new Error(
      'Skillpack path must be relative to ~/.pi/agent/skillpacks.',
    )
  }

  const parts = trimmed
    .split('/')
    .filter((part) => part.length > 0 && part !== '.')

  if (parts.length === 0) {
    throw new Error('Skillpack path is required.')
  }

  if (parts.some((part) => part === '..')) {
    throw new Error("Skillpack path cannot contain '..' segments.")
  }

  return parts.join('/')
}

function resolveSkillpackDirectory(rootDir: string, rawInput: string): string {
  return join(rootDir, ...normalizeSkillpackPath(rawInput).split('/'))
}

async function scanSkillDirectory(
  absoluteDir: string,
  relativeDir = '',
): Promise<string[]> {
  let entries: Dirent[]

  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch (error) {
    const errno = error as NodeJS.ErrnoException

    if (errno.code === 'ENOENT') {
      return []
    }

    throw error
  }

  entries.sort((left, right) => left.name.localeCompare(right.name))

  const containsSkill = entries.some(
    (entry) => entry.isFile() && entry.name === SKILL_FILE_NAME,
  )

  const childDirectories = entries.filter((entry) => entry.isDirectory())

  const childSkillPaths = await Promise.all(
    childDirectories.map(async (entry) => {
      const childRelative = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name

      return scanSkillDirectory(join(absoluteDir, entry.name), childRelative)
    }),
  )

  return [
    ...(containsSkill ? [join(absoluteDir, SKILL_FILE_NAME)] : []),
    ...childSkillPaths.flat(),
  ].sort((left, right) => left.localeCompare(right))
}

export function resolveProfileSkillpackSelections(
  selections: Array<string | ProfileSkillpackSelection>,
): string[] {
  const resolved = new Set<string>()

  for (const selection of selections) {
    if (typeof selection === 'string') {
      resolved.add(normalizeSkillpackPath(selection))
      continue
    }

    const rootPath = normalizeSkillpackPath(selection.path)

    if (!selection.skills || selection.skills.length === 0) {
      resolved.add(rootPath)
      continue
    }

    for (const skill of selection.skills) {
      resolved.add(normalizeSkillpackPath(`${rootPath}/${skill}`))
    }
  }

  return Array.from(resolved).sort((left, right) => left.localeCompare(right))
}

export async function resolveSelectedSkillpackEntryPoints(
  rootDir: string,
  selectedPaths: Iterable<string>,
): Promise<string[]> {
  const uniqueSkillPaths = new Set<string>()

  for (const selectedPath of selectedPaths) {
    const absoluteDir = resolveSkillpackDirectory(rootDir, selectedPath)

    for (const skillPath of await scanSkillDirectory(absoluteDir)) {
      uniqueSkillPaths.add(skillPath)
    }
  }

  return Array.from(uniqueSkillPaths).sort((left, right) =>
    left.localeCompare(right),
  )
}
