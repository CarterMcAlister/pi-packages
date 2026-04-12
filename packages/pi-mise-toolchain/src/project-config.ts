import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseToml } from '@iarna/toml'
import type { PackageManager, ProjectToolchainConfig } from './config'

const SUPPORTED_PACKAGE_MANAGERS: PackageManager[] = ['bun', 'pnpm', 'npm']

export const DEFAULT_PROJECT_TOOLCHAIN_CONFIG: ProjectToolchainConfig = {
  sourcePath: null,
  features: {
    enforcePackageManager: 'disabled',
    rewritePython: 'disabled',
  },
  packageManager: {
    selected: null,
  },
}

function createDefaultProjectToolchainConfig(): ProjectToolchainConfig {
  return structuredClone(DEFAULT_PROJECT_TOOLCHAIN_CONFIG)
}

function findNearestMiseTomlPath(startDir: string): string | null {
  let dir = startDir
  const home = homedir()

  while (true) {
    if (dir === home) return null

    const candidate = join(dir, 'mise.toml')
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }

    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function getToolsTable(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object') return {}

  const tools = (parsed as { tools?: unknown }).tools
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
    return {}
  }

  return tools as Record<string, unknown>
}

function hasTool(tools: Record<string, unknown>, name: string): boolean {
  return Object.hasOwn(tools, name)
}

function deriveProjectToolchainConfig(
  sourcePath: string,
  rawConfig: string,
): ProjectToolchainConfig {
  const parsed = parseToml(rawConfig)
  const tools = getToolsTable(parsed)
  const hasUv = hasTool(tools, 'uv')
  const packageManagers = SUPPORTED_PACKAGE_MANAGERS.filter((manager) =>
    hasTool(tools, manager),
  )

  return {
    sourcePath,
    features: {
      rewritePython: hasUv ? 'rewrite' : 'disabled',
      enforcePackageManager:
        packageManagers.length === 1 ? 'rewrite' : 'disabled',
    },
    packageManager: {
      selected: packageManagers.length === 1 ? packageManagers[0] : null,
    },
  }
}

export async function findProjectToolchainConfig(
  startDir = process.cwd(),
): Promise<ProjectToolchainConfig> {
  const sourcePath = findNearestMiseTomlPath(startDir)
  if (!sourcePath) {
    return createDefaultProjectToolchainConfig()
  }

  try {
    const rawConfig = await readFile(sourcePath, 'utf8')
    return deriveProjectToolchainConfig(sourcePath, rawConfig)
  } catch {
    const fallback = createDefaultProjectToolchainConfig()
    fallback.sourcePath = sourcePath
    return fallback
  }
}
