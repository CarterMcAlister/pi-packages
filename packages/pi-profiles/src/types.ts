import type { PackageSource } from '@mariozechner/pi-coding-agent'

export type ProfileScope = 'user' | 'project'

export interface ProfileRef {
  scope: ProfileScope
  name: string
  rootDir: string
  profileDir: string
  settingsPath: string
}

export interface SerializedProfileRef {
  scope: ProfileScope
  name: string
}

export interface ProfileSkillpackSelection {
  path: string
  skills?: string[]
}

export interface ProfileSettings {
  description?: string
  packages?: PackageSource[]
  extensions?: string[]
  skills?: string[]
  prompts?: string[]
  themes?: string[]
  skillpacks?: Array<string | ProfileSkillpackSelection>
  theme?: string
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  [key: string]: unknown
}

export interface LoadedProfile {
  ref: ProfileRef
  settings: ProfileSettings
}

export interface ResolvedProfileResources {
  profile: LoadedProfile
  extensionPaths: string[]
  skillPaths: string[]
  promptPaths: string[]
  themePaths: string[]
}
