import { dirname, join } from 'node:path'

type ReleaseType = 'patch' | 'minor' | 'major'

type PackageJson = {
  name?: string
  version?: string
}

function fail(message: string): never {
  throw new Error(message)
}

function parseReleaseType(value: string | undefined): ReleaseType {
  if (value === 'patch' || value === 'minor' || value === 'major') {
    return value
  }

  return fail(`Unsupported release type: ${value ?? '(missing)'}`)
}

function bumpVersion(version: string, releaseType: ReleaseType): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)

  if (!match) {
    return fail(
      `Unsupported version format: ${version}. Expected a stable semver like 1.2.3.`,
    )
  }

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])

  switch (releaseType) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
  }
}

function toTag(packageName: string, version: string): string {
  const packageSlug = packageName.replace(/^@/, '').replaceAll('/', '-')
  return `${packageSlug}-v${version}`
}

async function main() {
  const [packageDirArg, releaseTypeArg] = Bun.argv.slice(2)
  const packageDir = packageDirArg?.trim()
  const releaseType = parseReleaseType(releaseTypeArg)

  if (!packageDir) {
    fail('Missing package directory argument.')
  }

  const packageJsonPath = join(packageDir, 'package.json')
  const packageJsonFile = Bun.file(packageJsonPath)

  if (!(await packageJsonFile.exists())) {
    fail(`Could not find package.json at ${packageJsonPath}`)
  }

  const pkg = (await packageJsonFile.json()) as PackageJson
  const packageName = pkg.name?.trim()
  const currentVersion = pkg.version?.trim()

  if (!packageName) {
    fail(`Package name is missing in ${packageJsonPath}`)
  }

  if (!currentVersion) {
    fail(`Package version is missing in ${packageJsonPath}`)
  }

  const nextVersion = bumpVersion(currentVersion, releaseType)
  const nextTag = toTag(packageName, nextVersion)
  const nextPackageJson = {
    ...pkg,
    version: nextVersion,
  }

  await Bun.write(
    packageJsonPath,
    `${JSON.stringify(nextPackageJson, null, 2)}\n`,
  )

  const packageBasename =
    dirname(packageJsonPath).split('/').at(-1) ?? packageDir

  console.log(`package_dir=${packageDir}`)
  console.log(`package_basename=${packageBasename}`)
  console.log(`name=${packageName}`)
  console.log(`old_version=${currentVersion}`)
  console.log(`version=${nextVersion}`)
  console.log(`tag=${nextTag}`)
  console.log(`release_name=${packageName}@${nextVersion}`)
}

await main()
