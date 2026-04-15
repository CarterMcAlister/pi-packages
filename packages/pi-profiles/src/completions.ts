import { discoverProfiles, formatProfileRef } from './profile-discovery'

interface AutocompleteItemLike {
  value: string
  label: string
  description?: string
}

import type { SerializedProfileRef } from './types'

function matchesPrefix(value: string, prefix: string): boolean {
  return value.startsWith(prefix.trim())
}

export async function getProfileCompletions(
  cwd: string,
  prefix: string,
): Promise<AutocompleteItemLike[] | null> {
  const profiles = await discoverProfiles(cwd)
  const normalizedPrefix = prefix.trim()

  const items = profiles
    .map((profile) => ({
      value: formatProfileRef(profile),
      label: formatProfileRef(profile),
      description: `${profile.scope} profile`,
    }))
    .filter((profile) => matchesPrefix(profile.value, normalizedPrefix))

  return items.length > 0 ? items : null
}

export function getActiveProfileCompletion(
  activeProfile: SerializedProfileRef | null,
  prefix: string,
): AutocompleteItemLike[] | null {
  if (!activeProfile) {
    return null
  }

  const value = formatProfileRef(activeProfile)

  if (!matchesPrefix(value, prefix)) {
    return null
  }

  return [
    {
      value,
      label: value,
      description: 'active profile',
    },
  ]
}
