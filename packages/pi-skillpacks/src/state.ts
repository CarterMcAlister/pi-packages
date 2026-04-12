import { STATE_ENTRY_TYPE } from './constants';
import { normalizeSkillpackPath } from './paths';

export interface SkillpackState {
  selectedPaths: string[];
}

export interface SessionEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
}

function normalizeStatePayload(data: unknown): string[] | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const selectedPaths = (data as { selectedPaths?: unknown }).selectedPaths;

  if (!Array.isArray(selectedPaths)) {
    return null;
  }

  const normalizedPaths: string[] = [];

  for (const entry of selectedPaths) {
    if (typeof entry !== 'string') {
      return null;
    }

    normalizedPaths.push(normalizeSkillpackPath(entry));
  }

  return Array.from(new Set(normalizedPaths)).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function createSkillpackState(
  selectedPaths: Iterable<string>,
): SkillpackState {
  return {
    selectedPaths: Array.from(new Set(selectedPaths)).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export function restoreSelectedPathsFromEntries(
  entries: SessionEntryLike[],
): string[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry.type !== 'custom' || entry.customType !== STATE_ENTRY_TYPE) {
      continue;
    }

    const normalizedState = normalizeStatePayload(entry.data);

    if (normalizedState) {
      return normalizedState;
    }
  }

  return [];
}
