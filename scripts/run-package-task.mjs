#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const task = process.argv[2]

if (!['install', 'lint', 'typecheck', 'test', 'check'].includes(task)) {
  console.error(
    'Usage: node scripts/run-package-task.mjs <install|lint|typecheck|test|check>',
  )
  process.exit(2)
}

const root = process.cwd()
const packageRoot = join(root, 'packages')
const forkPackages = new Set([
  'pi-multicodex',
  'pi-codex-ask-user',
  'pi-powerline-footer',
  'pi-lens',
])

const packages = readdirSync(packageRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(packageRoot, name, 'package.json')))
  .sort()

function readPackage(name) {
  return JSON.parse(
    readFileSync(join(packageRoot, name, 'package.json'), 'utf8'),
  )
}

function run(label, command, args, cwd = root) {
  console.log(`\n==> ${label}`)
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  })
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}

function runRoot(script) {
  return run(`root: ${script}`, 'bun', ['run', script])
}

function runScript(name, script) {
  return run(`${name}: ${script}`, 'bun', [
    'run',
    '--cwd',
    join('packages', name),
    script,
  ])
}

function runIfScript(name, script) {
  const pkg = readPackage(name)
  if (pkg.scripts?.[script]) return runScript(name, script)
  console.log(`\n==> ${name}: ${script}`)
  console.log(`skip: no ${script} script`)
  return 0
}

function runForkTask(name, requestedTask) {
  const cwd = join('packages', name)

  if (requestedTask === 'install')
    return run(`${name}: install`, 'bun', ['install'], cwd)

  if (name === 'pi-multicodex') {
    if (requestedTask === 'lint') return runScript(name, 'lint')
    if (requestedTask === 'typecheck') return runScript(name, 'tsgo')
    if (requestedTask === 'test') return runScript(name, 'test')
    if (requestedTask === 'check')
      return (
        runForkTask(name, 'lint') ||
        runForkTask(name, 'typecheck') ||
        runForkTask(name, 'test')
      )
  }

  if (name === 'pi-codex-ask-user') {
    if (requestedTask === 'lint') return 0
    if (requestedTask === 'typecheck') return 0
    if (requestedTask === 'test') return 0
    if (requestedTask === 'check') return runScript(name, 'check')
  }

  if (name === 'pi-powerline-footer') {
    if (requestedTask === 'lint') return 0
    if (requestedTask === 'typecheck') return 0
    if (requestedTask === 'test') return runScript(name, 'test')
    if (requestedTask === 'check') return runForkTask(name, 'test')
  }

  if (name === 'pi-lens') {
    if (requestedTask === 'lint') return runScript(name, 'lint')
    if (requestedTask === 'typecheck') return runScript(name, 'lint')
    if (requestedTask === 'test') return runScript(name, 'test')
    if (requestedTask === 'check')
      return (
        runScript(name, 'check') ||
        runScript(name, 'lint') ||
        runScript(name, 'test')
      )
  }

  return runIfScript(name, requestedTask)
}

function runNonForkPackageTask(requestedTask) {
  let failed = false
  for (const name of packages) {
    if (forkPackages.has(name)) continue
    if (runIfScript(name, requestedTask) !== 0) failed = true
  }
  return failed ? 1 : 0
}

function runForkPackages(requestedTask) {
  let failed = false
  for (const name of packages) {
    if (!forkPackages.has(name)) continue
    if (runForkTask(name, requestedTask) !== 0) failed = true
  }
  return failed ? 1 : 0
}

let failed = false

if (task === 'install') {
  failed = run('root/workspaces: install', 'bun', ['install']) !== 0 || failed
} else if (task === 'lint') {
  failed = runRoot('lint') !== 0 || failed
  failed = runForkPackages('lint') !== 0 || failed
} else if (task === 'typecheck') {
  failed = runRoot('typecheck') !== 0 || failed
  failed = runForkPackages('typecheck') !== 0 || failed
} else if (task === 'test') {
  failed = runNonForkPackageTask('test') !== 0 || failed
  failed = runForkPackages('test') !== 0 || failed
} else if (task === 'check') {
  failed = runRoot('lint') !== 0 || failed
  failed = runRoot('typecheck') !== 0 || failed
  failed = runNonForkPackageTask('test') !== 0 || failed
  failed = runForkPackages('check') !== 0 || failed
}

process.exit(failed ? 1 : 0)
