#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const packagesDir = join(root, 'packages')
const readmePath = join(root, 'README.md')
const rootPackagePath = join(root, 'package.json')

function fail(message) {
  failures.push(message)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function markdownCode(value) {
  return `\`${value}\``
}

function withoutDotSlash(path) {
  return path.replace(/^\.\//, '')
}

function uniqueDuplicates(values) {
  const seen = new Set()
  const duplicates = new Set()

  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }

  return [...duplicates]
}

const failures = []

if (!existsSync(readmePath)) {
  console.error('Missing README.md')
  process.exit(1)
}

const readme = readFileSync(readmePath, 'utf8')
const rootPackage = readJson(rootPackagePath)
const workspaceGlobs = rootPackage.workspaces ?? []
const rootExtensions = rootPackage.pi?.extensions ?? []

if (!workspaceGlobs.includes('packages/*')) {
  fail('Root package.json workspaces must include "packages/*"')
}

if (!Array.isArray(rootExtensions)) {
  fail('Root package.json pi.extensions must be an array')
}

for (const extension of uniqueDuplicates(rootExtensions)) {
  fail(`Root package.json pi.extensions contains duplicate entry ${extension}`)
}

const packages = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((dir) => existsSync(join(packagesDir, dir, 'package.json')))
  .map((dir) => ({
    dir,
    packageJsonPath: join(packagesDir, dir, 'package.json'),
    readmePath: join(packagesDir, dir, 'README.md'),
    pkg: readJson(join(packagesDir, dir, 'package.json')),
  }))
  .sort((a, b) => a.dir.localeCompare(b.dir))

const packageNames = new Set(packages.map(({ pkg }) => pkg.name))
const packageDirs = new Set(packages.map(({ dir }) => dir))
const packagesByDir = new Map(
  packages.map((packageInfo) => [packageInfo.dir, packageInfo]),
)
const rootExtensionSet = new Set(rootExtensions)

for (const packageInfo of packages) {
  const packageName = packageInfo.pkg.name
  const packageDirectory = `packages/${packageInfo.dir}`
  const packageExtensions = packageInfo.pkg.pi?.extensions ?? []

  if (!packageName) {
    fail(`${packageDirectory}/package.json is missing a name`)
    continue
  }

  if (!existsSync(packageInfo.readmePath)) {
    fail(`${packageDirectory} is missing README.md`)
  }

  if (!readme.includes(markdownCode(packageName))) {
    fail(
      `README.md package table is missing ${markdownCode(packageName)} for ${packageDirectory}`,
    )
  }

  if (!readme.includes(markdownCode(packageDirectory))) {
    fail(`README.md package table is missing ${markdownCode(packageDirectory)}`)
  }

  if (packageInfo.pkg.pi?.extensions && !Array.isArray(packageExtensions)) {
    fail(`${packageDirectory}/package.json pi.extensions must be an array`)
    continue
  }

  for (const extension of uniqueDuplicates(packageExtensions)) {
    fail(
      `${packageDirectory}/package.json pi.extensions contains duplicate entry ${extension}`,
    )
  }

  for (const extension of packageExtensions) {
    const packageExtensionPath = join(packagesDir, packageInfo.dir, extension)
    const rootExtension = `./packages/${packageInfo.dir}/${withoutDotSlash(extension)}`

    if (!existsSync(packageExtensionPath)) {
      fail(
        `${packageDirectory}/package.json pi.extensions entry does not exist: ${extension}`,
      )
    }

    if (!rootExtensionSet.has(rootExtension)) {
      fail(`Root package.json pi.extensions is missing ${rootExtension}`)
    }
  }

  const isInstallablePiPackage =
    !packageInfo.pkg.private && packageExtensions.length
  if (isInstallablePiPackage) {
    const installCommand = `pi install npm:${packageName}`
    if (!readme.includes(installCommand)) {
      fail(`README.md install section is missing ${installCommand}`)
    }
  }
}

for (const extension of rootExtensions) {
  const extensionPath = withoutDotSlash(extension)
  const rootExtensionPath = join(root, extensionPath)
  const match = extensionPath.match(/^packages\/([^/]+)\/(.+)$/)

  if (!existsSync(rootExtensionPath)) {
    fail(`Root package.json pi.extensions entry does not exist: ${extension}`)
  }

  if (!match) {
    fail(
      `Root package.json pi.extensions entry must point under packages/*: ${extension}`,
    )
    continue
  }

  const [, packageDir, packageExtension] = match
  if (!packageDirs.has(packageDir)) {
    fail(
      `Root package.json pi.extensions references unknown package directory: ${extension}`,
    )
    continue
  }

  const packageInfo = packagesByDir.get(packageDir)
  const packageExtensions = packageInfo?.pkg.pi?.extensions ?? []
  const packageExtensionSet = new Set(packageExtensions.map(withoutDotSlash))

  if (!packageExtensionSet.has(packageExtension)) {
    fail(
      `Root package.json pi.extensions entry ${extension} is not declared in ${`packages/${packageDir}/package.json`}`,
    )
  }
}

const readmePackageRows = [
  ...readme.matchAll(/^\| `([^`]+)` \| `packages\/([^`]+)` \|/gm),
]

for (const match of readmePackageRows) {
  const packageName = match[1]
  const packageDirectory = `packages/${match[2]}`
  const matchingPackage = packages.find(
    (packageInfo) => packageInfo.pkg.name === packageName,
  )

  if (!packageNames.has(packageName)) {
    fail(`README.md lists unknown package ${markdownCode(packageName)}`)
  }

  if (
    matchingPackage &&
    packageDirectory !== `packages/${matchingPackage.dir}`
  ) {
    fail(
      `README.md maps ${markdownCode(packageName)} to ${markdownCode(packageDirectory)}, expected ${markdownCode(`packages/${matchingPackage.dir}`)}`,
    )
  }
}

const installCommands = [...readme.matchAll(/^pi install npm:([^\s]+)$/gm)].map(
  (match) => match[1],
)
const installablePackageNames = new Set(
  packages
    .filter(({ pkg }) => !pkg.private && (pkg.pi?.extensions ?? []).length)
    .map(({ pkg }) => pkg.name),
)

for (const packageName of installCommands) {
  if (!installablePackageNames.has(packageName)) {
    fail(
      `README.md install section lists non-installable or unknown package ${packageName}`,
    )
  }
}

if (failures.length) {
  console.error('Package README/extension validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Package README/extension validation passed for ${packages.length} packages and ${rootExtensions.length} root extensions.`,
)
