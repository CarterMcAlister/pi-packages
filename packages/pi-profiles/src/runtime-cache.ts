import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  getAgentDir,
  SessionManager,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'
import { getProfileRuntimeDir } from './constants'
import type { SerializedProfileRef } from './types'

interface SessionProfileMap {
  [sessionFile: string]: SerializedProfileRef | null | undefined
}

interface ProcessProfileState {
  cwd: string
  sessionFile?: string
  activeProfile: SerializedProfileRef | null
}

function getSessionMapPath(agentDir = getAgentDir()): string {
  return join(getProfileRuntimeDir(agentDir), 'session-map.json')
}

function getProcessStatePath(
  pid = process.pid,
  agentDir = getAgentDir(),
): string {
  return join(getProfileRuntimeDir(agentDir), 'pids', `${pid}.json`)
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    const errno = error as NodeJS.ErrnoException

    if (errno.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readSessionProfileMap(
  agentDir = getAgentDir(),
): Promise<SessionProfileMap> {
  return (
    (await readJsonFile<SessionProfileMap>(getSessionMapPath(agentDir))) ?? {}
  )
}

async function writeSessionProfileMap(
  map: SessionProfileMap,
  agentDir = getAgentDir(),
): Promise<void> {
  await writeJsonFile(getSessionMapPath(agentDir), map)
}

export async function updateRuntimeProfileCache(
  input: {
    cwd: string
    sessionFile?: string
    activeProfile: SerializedProfileRef | null
  },
  agentDir = getAgentDir(),
): Promise<void> {
  const runtimeDir = getProfileRuntimeDir(agentDir)
  await mkdir(join(runtimeDir, 'pids'), { recursive: true })

  if (input.sessionFile) {
    const sessionMap = await readSessionProfileMap(agentDir)

    if (input.activeProfile) {
      sessionMap[input.sessionFile] = input.activeProfile
    } else {
      delete sessionMap[input.sessionFile]
    }

    await writeSessionProfileMap(sessionMap, agentDir)
  }

  await writeJsonFile(getProcessStatePath(process.pid, agentDir), {
    cwd: input.cwd,
    sessionFile: input.sessionFile,
    activeProfile: input.activeProfile,
  } satisfies ProcessProfileState)
}

export async function clearRuntimeProfileProcessState(
  agentDir = getAgentDir(),
): Promise<void> {
  await rm(getProcessStatePath(process.pid, agentDir), { force: true })
}

async function readProcessProfileState(
  agentDir = getAgentDir(),
): Promise<ProcessProfileState | null> {
  return readJsonFile<ProcessProfileState>(
    getProcessStatePath(process.pid, agentDir),
  )
}

export async function resolveBootstrapProfileRef(
  cwd: string,
  agentDir = getAgentDir(),
): Promise<SerializedProfileRef | null> {
  const processState = await readProcessProfileState(agentDir)

  if (processState?.cwd === cwd) {
    return processState.activeProfile
  }

  const settingsManager = SettingsManager.create(cwd, agentDir)
  const sessions = await SessionManager.list(
    cwd,
    settingsManager.getSessionDir(),
  )
  const currentSession = sessions[0]?.path

  if (!currentSession) {
    return null
  }

  const sessionMap = await readSessionProfileMap(agentDir)
  return sessionMap[currentSession] ?? null
}
