import { PROFILE_STATE_ENTRY_TYPE } from './constants'
import type { SerializedProfileRef } from './types'

export interface ProfileState {
  activeProfile: SerializedProfileRef | null
}

export interface SessionEntryLike {
  type: string
  customType?: string
  data?: unknown
}

function normalizeProfileRef(data: unknown): SerializedProfileRef | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  const scope = (data as { scope?: unknown }).scope
  const name = (data as { name?: unknown }).name

  if (
    (scope !== 'user' && scope !== 'project') ||
    typeof name !== 'string' ||
    name.trim().length === 0
  ) {
    return null
  }

  return {
    scope,
    name: name.trim(),
  }
}

function normalizeStatePayload(data: unknown): ProfileState | null {
  if (!data || typeof data !== 'object') {
    return null
  }

  if (!('activeProfile' in data)) {
    return null
  }

  const activeProfile = (data as { activeProfile?: unknown }).activeProfile

  if (activeProfile === null) {
    return { activeProfile: null }
  }

  const normalizedProfile = normalizeProfileRef(activeProfile)

  if (!normalizedProfile) {
    return null
  }

  return {
    activeProfile: normalizedProfile,
  }
}

export function createProfileState(
  activeProfile: SerializedProfileRef | null,
): ProfileState {
  return { activeProfile }
}

export function restoreActiveProfileFromEntries(
  entries: SessionEntryLike[],
): SerializedProfileRef | null | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]

    if (
      entry.type !== 'custom' ||
      entry.customType !== PROFILE_STATE_ENTRY_TYPE
    ) {
      continue
    }

    const normalizedState = normalizeStatePayload(entry.data)

    if (normalizedState) {
      return normalizedState.activeProfile
    }
  }

  return undefined
}
