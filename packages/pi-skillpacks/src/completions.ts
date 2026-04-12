import type { AutocompleteItem } from '@mariozechner/pi-tui';
import {
  listSelectableSkillpackTargets,
  type SkillpackTarget,
} from './discovery';

function normalizePrefix(prefix: string): string {
  return prefix.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function describeTarget(kind: 'group' | 'skill', skillCount: number): string {
  return `${kind} • ${skillCount === 1 ? '1 skill' : `${skillCount} skills`}`;
}

export async function getAddCompletions(
  rootDir: string,
  prefix: string,
): Promise<AutocompleteItem[] | null> {
  const normalizedPrefix = normalizePrefix(prefix);

  let targets: SkillpackTarget[];

  try {
    targets = await listSelectableSkillpackTargets(rootDir);
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;

    if (errno.code === 'ENOENT') {
      return null;
    }

    throw error;
  }

  const items = targets
    .filter((target) => target.value.startsWith(normalizedPrefix))
    .map((target) => ({
      value: target.value,
      label: target.value,
      description: describeTarget(target.kind, target.skillCount),
    }));

  return items.length > 0 ? items : null;
}

export function getRemoveCompletions(
  selectedPaths: Iterable<string>,
  prefix: string,
): AutocompleteItem[] | null {
  const normalizedPrefix = normalizePrefix(prefix);

  const items = Array.from(new Set(selectedPaths))
    .sort((left, right) => left.localeCompare(right))
    .filter((path) => path.startsWith(normalizedPrefix))
    .map((path) => ({
      value: path,
      label: path,
      description: 'active selection',
    }));

  return items.length > 0 ? items : null;
}
