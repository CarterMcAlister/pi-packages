import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'
import { getProfileRuntimeDir } from './constants'
import {
  readProfileSettings,
  resolveProfilePackageSources,
  resolveProfileResourceSpecifiers,
} from './profile-settings'
import {
  getDefaultSkillpackRoot,
  normalizeSkillpackPath,
  resolveSelectedSkillpackEntryPoints,
} from './skillpacks'
import type {
  LoadedProfile,
  ProfileRef,
  ResolvedProfileResources,
} from './types'

function stableHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 12)
}

async function ensureLocalBundleDir(
  profile: LoadedProfile,
  skillpackRoot: string,
  agentDir: string,
): Promise<string | null> {
  const extensions = resolveProfileResourceSpecifiers(
    profile.ref.profileDir,
    profile.settings.extensions,
  )
  const skills = resolveProfileResourceSpecifiers(
    profile.ref.profileDir,
    profile.settings.skills,
  )
  const prompts = resolveProfileResourceSpecifiers(
    profile.ref.profileDir,
    profile.settings.prompts,
  )
  const themes = resolveProfileResourceSpecifiers(
    profile.ref.profileDir,
    profile.settings.themes,
  )

  const skillpacks = Array.from(
    new Set((profile.settings.skillpacks ?? []).map(normalizeSkillpackPath)),
  )

  const skillpackSkillPaths = await resolveSelectedSkillpackEntryPoints(
    skillpackRoot,
    skillpacks,
  )

  const manifest = {
    name: `pi-profiles-runtime-${stableHash(profile.ref)}`,
    private: true,
    pi: {
      extensions,
      skills: [...skills, ...skillpackSkillPaths],
      prompts,
      themes,
    },
  }

  const hasLocalResources = Object.values(manifest.pi).some(
    (entries) => entries.length > 0,
  )

  if (!hasLocalResources) {
    return null
  }

  const manifestHash = stableHash({
    profile: profile.ref,
    manifest,
  })
  const bundleDir = join(
    getProfileRuntimeDir(agentDir),
    'bundles',
    manifestHash,
  )

  await mkdir(bundleDir, { recursive: true })
  await writeFile(
    join(bundleDir, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )

  return bundleDir
}

function extractEnabledPaths(
  resources: Array<{ path: string; enabled: boolean }>,
): string[] {
  return resources
    .filter((resource) => resource.enabled)
    .map((resource) => resource.path)
    .sort((left, right) => left.localeCompare(right))
}

export async function resolveProfileResources(
  ref: ProfileRef,
  options: {
    cwd?: string
    agentDir?: string
    skillpackRoot?: string
  } = {},
): Promise<ResolvedProfileResources> {
  const _cwd = options.cwd ?? process.cwd()
  const agentDir = options.agentDir ?? getAgentDir()
  const skillpackRoot = options.skillpackRoot ?? getDefaultSkillpackRoot()
  const profile = await readProfileSettings(ref)
  const localBundleDir = await ensureLocalBundleDir(
    profile,
    skillpackRoot,
    agentDir,
  )
  const packageSources = resolveProfilePackageSources(
    profile.ref.profileDir,
    profile.settings.packages,
  )

  const packageEntries = [
    ...packageSources,
    ...(localBundleDir ? [localBundleDir] : []),
  ]

  if (packageEntries.length === 0) {
    return {
      profile,
      extensionPaths: [],
      skillPaths: [],
      promptPaths: [],
      themePaths: [],
    }
  }

  const resolveHash = stableHash({
    profile: profile.ref,
    packageEntries,
  })
  const resolveRoot = join(
    getProfileRuntimeDir(agentDir),
    'resolvers',
    resolveHash,
  )
  const resolveWorkspaceDir = join(resolveRoot, 'workspace')
  const resolveAgentDir = join(resolveRoot, 'agent')

  await mkdir(resolveWorkspaceDir, { recursive: true })
  await mkdir(resolveAgentDir, { recursive: true })

  const settingsManager = SettingsManager.inMemory()
  settingsManager.setProjectPackages(packageEntries)

  const packageManager = new DefaultPackageManager({
    cwd: resolveWorkspaceDir,
    agentDir: resolveAgentDir,
    settingsManager,
  })
  const resolved = await packageManager.resolve()

  return {
    profile,
    extensionPaths: extractEnabledPaths(resolved.extensions),
    skillPaths: extractEnabledPaths(resolved.skills),
    promptPaths: extractEnabledPaths(resolved.prompts),
    themePaths: extractEnabledPaths(resolved.themes),
  }
}
