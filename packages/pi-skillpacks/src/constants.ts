import { homedir } from 'node:os'
import { join } from 'node:path'

export const SKILLPACKS_COMMAND = 'skillpacks'
export const SKILLPACKS_INSTALL_COMMAND = 'skillpacks:install'
export const SKILLPACKS_SEARCH_COMMAND = 'skillpacks:search'
export const STATE_ENTRY_TYPE = 'skillpack-state'
export const SKILL_FILE_NAME = 'SKILL.md'

export function getDefaultSkillpackRoot(): string {
  return join(homedir(), '.pi', 'agent', 'skillpacks')
}
