import { join } from 'node:path'

type ReleaseType = 'patch' | 'minor' | 'major'

type PackageJson = {
  name?: string
  version?: string
}

type ReleasePlanItem = {
  packageDir: string
  packageBasename: string
  packageName: string
  currentVersion: string
  releaseType: ReleaseType
  previousTag: string | null
}

const PACKAGE_DIRS = [
  'packages/pi-skillpacks',
  'packages/pi-mise-toolchain',
  'packages/pi-worktrunk',
] as const

function fail(message: string): never {
  throw new Error(message)
}

function runGit(args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    fail(
      stderr ||
        `git ${args.join(' ')} failed with exit code ${result.exitCode}`,
    )
  }

  return result.stdout.toString()
}

function runGitAllowFailure(args: string[]): string | null {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    return null
  }

  return result.stdout.toString()
}

function toTagPattern(packageName: string): string {
  return `${packageName.replace(/^@/, '').replaceAll('/', '-')}-v*`
}

function getLatestTag(packageName: string): string | null {
  const output = runGitAllowFailure([
    'tag',
    '--list',
    toTagPattern(packageName),
    '--sort=-version:refname',
  ])

  if (!output) {
    return null
  }

  const latest = output
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return latest ?? null
}

function getCommitMessages(range: string | null, packageDir: string): string[] {
  const args = ['log', '--format=%s%n%b%x00']

  if (range) {
    args.push(range)
  }

  args.push('--', packageDir)

  return runGit(args)
    .split('\u0000')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function hasPackageChanges(range: string | null, packageDir: string): boolean {
  if (!range) {
    return true
  }

  return runGit(['diff', '--name-only', range, '--', packageDir])
    .split('\n')
    .map((line) => line.trim())
    .some(Boolean)
}

function detectReleaseType(messages: string[]): ReleaseType {
  let releaseType: ReleaseType = 'patch'

  for (const message of messages) {
    if (
      /BREAKING CHANGE:/i.test(message) ||
      /^\w+(\([^)]+\))?!:/m.test(message)
    ) {
      return 'major'
    }

    if (/^feat(\([^)]+\))?:/m.test(message)) {
      releaseType = 'minor'
    }
  }

  return releaseType
}

async function getPackageInfo(packageDir: string): Promise<{
  packageName: string
  currentVersion: string
}> {
  const packageJsonPath = join(packageDir, 'package.json')
  const file = Bun.file(packageJsonPath)

  if (!(await file.exists())) {
    fail(`Missing package.json for ${packageDir}`)
  }

  const pkg = (await file.json()) as PackageJson
  const packageName = pkg.name?.trim()
  const currentVersion = pkg.version?.trim()

  if (!packageName || !currentVersion) {
    fail(`Package name/version missing in ${packageJsonPath}`)
  }

  return { packageName, currentVersion }
}

async function main() {
  const plan: ReleasePlanItem[] = []

  for (const packageDir of PACKAGE_DIRS) {
    const { packageName, currentVersion } = await getPackageInfo(packageDir)
    const previousTag = getLatestTag(packageName)
    const range = previousTag ? `${previousTag}..HEAD` : null

    if (!hasPackageChanges(range, packageDir)) {
      continue
    }

    const messages = getCommitMessages(range, packageDir)

    if (messages.length === 0) {
      continue
    }

    plan.push({
      packageDir,
      packageBasename: packageDir.split('/').at(-1) ?? packageDir,
      packageName,
      currentVersion,
      releaseType: detectReleaseType(messages),
      previousTag,
    })
  }

  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
}

await main()
