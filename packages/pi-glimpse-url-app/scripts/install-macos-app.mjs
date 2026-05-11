#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (platform() !== 'darwin') {
  console.error('Glimpse URL.app installation is only supported on macOS.')
  process.exit(1)
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const launcherSource = join(packageRoot, 'bin', 'glimpse-url.mjs')
const glimpseMain = fileURLToPath(import.meta.resolve('glimpseui'))
const glimpseSourceDir = dirname(glimpseMain)
const glimpseHost = join(glimpseSourceDir, 'glimpse')
const glimpseBuildScript = join(glimpseSourceDir, '..', 'scripts', 'build.mjs')
const localBin = join(homedir(), '.local', 'bin')
const launcherPath = join(localBin, 'glimpse-url')
const appPath = join(homedir(), 'Applications', 'Glimpse URL.app')
const logPath = join(homedir(), 'Library', 'Logs', 'glimpse-url.log')

mkdirSync(localBin, { recursive: true })
mkdirSync(dirname(appPath), { recursive: true })
mkdirSync(dirname(logPath), { recursive: true })

if (!existsSync(glimpseHost)) {
  console.log('Building local Glimpse macOS host...')
  execFileSync(process.execPath, [glimpseBuildScript, 'darwin'], {
    cwd: resolve(glimpseSourceDir, '..'),
    stdio: 'inherit',
  })
}

writeFileSync(
  launcherPath,
  `#!/usr/bin/env bash
exec node ${JSON.stringify(launcherSource)} "$@"
`,
)
chmodSync(launcherPath, 0o755)

const appleScript = `on run
\tdisplay dialog "Glimpse URL is a helper app for opening Plannotator windows. Configure Pi with PLANNOTATOR_BROWSER=\\"Glimpse URL\\"." buttons {"OK"} default button "OK"
end run

on open location theURL
\tset launcherPath to POSIX path of (path to home folder) & ".local/bin/glimpse-url"
\tset logPath to POSIX path of (path to home folder) & "Library/Logs/glimpse-url.log"
\tdo shell script "mkdir -p " & quoted form of (POSIX path of (path to home folder) & "Library/Logs") & "; " & quoted form of launcherPath & " " & quoted form of theURL & " >> " & quoted form of logPath & " 2>&1 &"
end open location

on open theItems
\trepeat with anItem in theItems
\t\tset launcherPath to POSIX path of (path to home folder) & ".local/bin/glimpse-url"
\t\tset logPath to POSIX path of (path to home folder) & "Library/Logs/glimpse-url.log"
\t\tdo shell script "mkdir -p " & quoted form of (POSIX path of (path to home folder) & "Library/Logs") & "; " & quoted form of launcherPath & " " & quoted form of (POSIX path of anItem) & " >> " & quoted form of logPath & " 2>&1 &"
\tend repeat
end open
`

const tempDir = mkdtempSync(join(tmpdir(), 'glimpse-url-app-'))
const scriptPath = join(tempDir, 'Glimpse URL.applescript')

try {
  rmSync(appPath, { recursive: true, force: true })
  writeFileSync(scriptPath, appleScript)
  execFileSync('osacompile', ['-o', appPath, scriptPath], { stdio: 'inherit' })

  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  if (existsSync(lsregister)) {
    execFileSync(lsregister, ['-f', appPath], { stdio: 'ignore' })
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

console.log(`Installed ${appPath}`)
console.log(`Installed ${launcherPath}`)
console.log('Use: set -gx PLANNOTATOR_BROWSER "Glimpse URL"')
