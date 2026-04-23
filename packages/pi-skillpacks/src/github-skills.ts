import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const GH_MAX_BUFFER = 16 * 1024 * 1024
const SEARCH_JSON_FIELDS = [
  'repo',
  'skillName',
  'namespace',
  'description',
  'stars',
  'path',
] as const

export interface GhSkillSearchResult {
  repo: string
  skillName: string
  namespace: string
  description: string
  stars: number
  path: string
}

export interface ParsedGitHubRepoReference {
  host: string
  owner: string
  repo: string
  canonical: string
}

export interface SkillpackInstallOptions {
  force?: boolean
}

export interface SkillpackGitHubClient {
  searchSkills(query: string, limit?: number): Promise<GhSkillSearchResult[]>
  discoverRepoSkillPaths(repoRef: string): Promise<string[]>
  installSkill(
    repoRef: string,
    skillPath: string,
    directory: string,
    options?: SkillpackInstallOptions,
  ): Promise<void>
}

interface GitHubRepoApiResponse {
  default_branch?: unknown
}

interface GitHubTreeEntry {
  path?: unknown
  type?: unknown
}

interface GitHubTreeApiResponse {
  tree?: unknown
}

function runGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      { maxBuffer: GH_MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error) {
          const details = stderr.trim() || stdout.trim() || error.message
          reject(new Error(`gh ${args.join(' ')} failed: ${details}`))
          return
        }

        resolve({ stdout, stderr })
      },
    )
  })
}

async function runGhJson<T>(args: string[]): Promise<T> {
  const { stdout } = await runGh(args)

  try {
    return JSON.parse(stdout) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to parse JSON from gh ${args.join(' ')}: ${message}`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseGitHubRepoReference(
  input: string,
): ParsedGitHubRepoReference {
  let normalized = input.trim()

  if (!normalized) {
    throw new Error('GitHub repository is required.')
  }

  normalized = normalized
    .replace(/^https?:\/\//, '')
    .replace(/^github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')

  const parts = normalized.split('/').filter(Boolean)

  if (parts.length === 2) {
    const [owner, repo] = parts
    return {
      host: 'github.com',
      owner,
      repo,
      canonical: `${owner}/${repo}`,
    }
  }

  if (parts.length === 3) {
    const [host, owner, repo] = parts
    return {
      host,
      owner,
      repo,
      canonical: `${host}/${owner}/${repo}`,
    }
  }

  throw new Error(
    'GitHub repository must be in OWNER/REPO format (or HOST/OWNER/REPO).',
  )
}

export function getSkillpackDirectoryName(repoRef: string): string {
  const { host, owner, repo } = parseGitHubRepoReference(repoRef)
  const segments = host === 'github.com' ? [owner, repo] : [host, owner, repo]

  return segments
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

export function getSkillpackInstallDirectory(
  rootDir: string,
  repoRef: string,
): string {
  return join(rootDir, getSkillpackDirectoryName(repoRef))
}

function toInstallPath(skillFilePath: string): string {
  if (skillFilePath === 'SKILL.md') {
    return skillFilePath
  }

  return skillFilePath.endsWith('/SKILL.md')
    ? skillFilePath.slice(0, -'/SKILL.md'.length)
    : skillFilePath
}

export async function directoryHasEntries(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path)
    return entries.length > 0
  } catch (error) {
    const errno = error as NodeJS.ErrnoException

    if (errno.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

export const defaultSkillpackGitHubClient: SkillpackGitHubClient = {
  async searchSkills(query, limit = 20) {
    const rawResults = await runGhJson<unknown>([
      'skill',
      'search',
      query,
      '--json',
      SEARCH_JSON_FIELDS.join(','),
      '--limit',
      String(limit),
    ])

    if (!Array.isArray(rawResults)) {
      throw new Error('Unexpected gh skill search response.')
    }

    return rawResults.map((entry) => {
      if (!isRecord(entry)) {
        throw new Error('Unexpected gh skill search result entry.')
      }

      return {
        repo: String(entry.repo ?? ''),
        skillName: String(entry.skillName ?? ''),
        namespace: String(entry.namespace ?? ''),
        description: String(entry.description ?? ''),
        stars: Number(entry.stars ?? 0),
        path: String(entry.path ?? ''),
      }
    })
  },

  async discoverRepoSkillPaths(repoRef) {
    const repo = parseGitHubRepoReference(repoRef)
    const apiArgs = ['api']

    if (repo.host !== 'github.com') {
      apiArgs.push('--hostname', repo.host)
    }

    const repoInfo = await runGhJson<GitHubRepoApiResponse>([
      ...apiArgs,
      `repos/${repo.owner}/${repo.repo}`,
    ])
    const defaultBranch = String(repoInfo.default_branch ?? '').trim()

    if (!defaultBranch) {
      throw new Error(
        `Could not determine default branch for ${repo.canonical}.`,
      )
    }

    const treeResponse = await runGhJson<GitHubTreeApiResponse>([
      ...apiArgs,
      `repos/${repo.owner}/${repo.repo}/git/trees/${defaultBranch}?recursive=1`,
    ])

    if (!Array.isArray(treeResponse.tree)) {
      throw new Error(`Could not list skills for ${repo.canonical}.`)
    }

    return treeResponse.tree
      .filter((entry): entry is GitHubTreeEntry => isRecord(entry))
      .filter(
        (entry) =>
          entry.type === 'blob' &&
          typeof entry.path === 'string' &&
          entry.path.endsWith('SKILL.md'),
      )
      .map((entry) => toInstallPath(entry.path as string))
      .sort((left, right) => left.localeCompare(right))
  },

  async installSkill(repoRef, skillPath, directory, options = {}) {
    const repo = parseGitHubRepoReference(repoRef)
    const args = [
      'skill',
      'install',
      repo.canonical,
      skillPath,
      '--dir',
      directory,
      '--agent',
      'pi',
    ]

    if (options.force) {
      args.push('--force')
    }

    await runGh(args)
  },
}
