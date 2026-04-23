import { discoverProfiles, formatProfileRef } from './profile-discovery'

interface AutocompleteItemLike {
  value: string
  label: string
  description?: string
}

function matchesPrefix(value: string, prefix: string): boolean {
  return value.startsWith(prefix.trim())
}

export async function getProfileCompletions(
  cwd: string,
  prefix: string,
): Promise<AutocompleteItemLike[] | null> {
  const profiles = await discoverProfiles(cwd)
  const normalizedPrefix = prefix.trim()

  const items = [
    {
      value: 'none',
      label: 'none',
      description: 'unload the active profile',
    },
    ...profiles.map((profile) => ({
      value: formatProfileRef(profile),
      label: formatProfileRef(profile),
      description: `${profile.scope} profile`,
    })),
  ].filter((profile) => matchesPrefix(profile.value, normalizedPrefix))

  return items.length > 0 ? items : null
}
