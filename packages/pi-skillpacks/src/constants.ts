import { homedir } from 'node:os'
import { join } from 'node:path'

export const ADD_COMMAND = 'skillpack-add'
export const REMOVE_COMMAND = 'skillpack-remove'
export const SKILLPACKS_COMMAND = 'skillpacks'
export const STATE_ENTRY_TYPE = 'skillpack-state'
export const SKILL_FILE_NAME = 'SKILL.md'

export function getDefaultSkillpackRoot(): string {
  return join(homedir(), '.pi', 'agent', 'skillpacks')
}
