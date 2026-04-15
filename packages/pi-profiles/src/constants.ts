import { join } from 'node:path'
import { getAgentDir } from '@mariozechner/pi-coding-agent'

export const PROFILE_CREATE_COMMAND = 'profile-create'
export const PROFILE_LOAD_COMMAND = 'profile-load'
export const PROFILE_UNLOAD_COMMAND = 'profile-unload'
export const PROFILES_COMMAND = 'profiles'
export const PROFILE_STATE_ENTRY_TYPE = 'profile-state'
export const PROFILE_SETTINGS_FILE = 'settings.json'
export const PROFILE_RUNTIME_DIR_NAME = '.runtime'

export function getDefaultGlobalProfileRoot(agentDir = getAgentDir()): string {
  return join(agentDir, 'profiles')
}

export function getDefaultProjectProfileRoot(cwd: string): string {
  return join(cwd, '.pi', 'profiles')
}

export function getProfileRuntimeDir(agentDir = getAgentDir()): string {
  return join(getDefaultGlobalProfileRoot(agentDir), PROFILE_RUNTIME_DIR_NAME)
}
