import { isAbsolute, join } from 'node:path'

export interface ResolvedSkillpackPath {
  logicalPath: string
  absolutePath: string
}

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/

export function normalizeSkillpackPath(input: string): string {
  const trimmed = input.trim().replaceAll('\\', '/')

  if (!trimmed) {
    throw new Error('Skill pack path is required.')
  }

  if (
    trimmed.startsWith('/') ||
    WINDOWS_ABSOLUTE_PATH.test(trimmed) ||
    isAbsolute(trimmed)
  ) {
    throw new Error(
      'Skill pack path must be relative to ~/.pi/agent/skillpacks.',
    )
  }

  const parts = trimmed
    .split('/')
    .filter((part) => part.length > 0 && part !== '.')

  if (parts.length === 0) {
    throw new Error('Skill pack path is required.')
  }

  if (parts.some((part) => part === '..')) {
    throw new Error("Skill pack path cannot contain '..' segments.")
  }

  return parts.join('/')
}

export function resolveSkillpackDirectory(
  rootDir: string,
  rawInput: string,
): ResolvedSkillpackPath {
  const logicalPath = normalizeSkillpackPath(rawInput)

  return {
    logicalPath,
    absolutePath: join(rootDir, ...logicalPath.split('/')),
  }
}
