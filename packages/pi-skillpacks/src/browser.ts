import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SKILL_FILE_NAME } from './constants';
import { listSelectableSkillpackTargets } from './discovery';

export interface SkillpackBrowserItem {
  value: string;
  kind: 'group' | 'skill';
  skillCount: number;
  depth: number;
  label: string;
  title: string;
  description: string;
  body: string;
  skillFilePath?: string;
}

export type SkillpackBrowserStatus =
  | 'explicit'
  | 'active'
  | 'partial'
  | 'inactive';

interface ParsedSkillDocument {
  name: string;
  description: string;
  body: string;
}

function parseFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSkillDocument(text: string): ParsedSkillDocument {
  const normalized = text.replaceAll('\r\n', '\n');

  if (!normalized.startsWith('---\n')) {
    return {
      name: '',
      description: '',
      body: normalized.trim(),
    };
  }

  const closingIndex = normalized.indexOf('\n---\n', 4);

  if (closingIndex === -1) {
    return {
      name: '',
      description: '',
      body: normalized.trim(),
    };
  }

  const frontmatter = normalized.slice(4, closingIndex).split('\n');
  const body = normalized.slice(closingIndex + 5).trim();

  let name = '';
  let description = '';

  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = parseFrontmatterValue(rawValue);

    if (key === 'name') name = value;
    if (key === 'description') description = value;
  }

  return { name, description, body };
}

function includesQuery(
  item: SkillpackBrowserItem,
  normalizedQuery: string,
): boolean {
  const haystack =
    `${item.value}\n${item.label}\n${item.title}\n${item.description}`.toLowerCase();
  return haystack.includes(normalizedQuery);
}

function getAncestorPaths(value: string): string[] {
  const parts = value.split('/');
  const ancestors: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join('/'));
  }

  return ancestors;
}

function hasAncestorSelection(
  selectedPaths: ReadonlySet<string>,
  value: string,
): boolean {
  return Array.from(selectedPaths).some(
    (selectedPath) =>
      value !== selectedPath && value.startsWith(`${selectedPath}/`),
  );
}

function isSkillActive(
  selectedPaths: ReadonlySet<string>,
  value: string,
): boolean {
  return selectedPaths.has(value) || hasAncestorSelection(selectedPaths, value);
}

function getDescendantSkillItems(
  items: SkillpackBrowserItem[],
  value: string,
): SkillpackBrowserItem[] {
  return items.filter(
    (item) =>
      item.kind === 'skill' &&
      (item.value === value || item.value.startsWith(`${value}/`)),
  );
}

export async function loadSkillpackBrowserItems(
  rootDir: string,
): Promise<SkillpackBrowserItem[]> {
  const targets = await listSelectableSkillpackTargets(rootDir);

  return Promise.all(
    targets.map(async (target) => {
      const segments = target.value.split('/');
      const label = segments.at(-1) ?? target.value;

      if (target.kind === 'group') {
        return {
          value: target.value,
          kind: target.kind,
          skillCount: target.skillCount,
          depth: segments.length - 1,
          label,
          title: label,
          description: `Contains ${target.skillCount} ${target.skillCount === 1 ? 'skill' : 'skills'}.`,
          body: '',
        } satisfies SkillpackBrowserItem;
      }

      const skillFilePath = join(rootDir, ...segments, SKILL_FILE_NAME);
      const contents = await readFile(skillFilePath, 'utf8').catch(() => '');
      const parsed = parseSkillDocument(contents);

      return {
        value: target.value,
        kind: target.kind,
        skillCount: target.skillCount,
        depth: segments.length - 1,
        label,
        title: parsed.name || label,
        description: parsed.description || `Skill at ${target.value}`,
        body: parsed.body,
        skillFilePath,
      } satisfies SkillpackBrowserItem;
    }),
  );
}

export function filterSkillpackBrowserItems(
  items: SkillpackBrowserItem[],
  query: string,
): SkillpackBrowserItem[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  const directlyMatchedItems = items.filter((item) =>
    includesQuery(item, normalizedQuery),
  );
  const includedPaths = new Set<string>(
    directlyMatchedItems.map((item) => item.value),
  );

  for (const item of directlyMatchedItems) {
    for (const ancestor of getAncestorPaths(item.value)) {
      includedPaths.add(ancestor);
    }

    if (item.kind === 'group') {
      for (const candidate of items) {
        if (candidate.value.startsWith(`${item.value}/`)) {
          includedPaths.add(candidate.value);
        }
      }
    }
  }

  return items.filter((item) => includedPaths.has(item.value));
}

function hasCollapsedAncestor(
  collapsedPaths: ReadonlySet<string>,
  value: string,
): boolean {
  return Array.from(collapsedPaths).some((collapsedPath) =>
    value.startsWith(`${collapsedPath}/`),
  );
}

export function getVisibleSkillpackBrowserItems(
  items: SkillpackBrowserItem[],
  query: string,
  collapsedPaths: Iterable<string>,
): SkillpackBrowserItem[] {
  const filteredItems = filterSkillpackBrowserItems(items, query);

  if (query.trim().length > 0) {
    return filteredItems;
  }

  const collapsedSet = new Set(collapsedPaths);
  return filteredItems.filter(
    (item) => !hasCollapsedAncestor(collapsedSet, item.value),
  );
}

export function getSkillpackBrowserStatus(
  items: SkillpackBrowserItem[],
  selectedPaths: Iterable<string>,
  item: SkillpackBrowserItem,
): SkillpackBrowserStatus {
  const selectedSet = new Set(selectedPaths);

  if (selectedSet.has(item.value)) {
    return 'explicit';
  }

  if (item.kind === 'skill') {
    return isSkillActive(selectedSet, item.value) ? 'active' : 'inactive';
  }

  const descendantSkills = getDescendantSkillItems(items, item.value);
  const activeSkillCount = descendantSkills.filter((skill) =>
    isSkillActive(selectedSet, skill.value),
  ).length;

  if (activeSkillCount === 0) {
    return 'inactive';
  }

  if (activeSkillCount === descendantSkills.length) {
    return 'active';
  }

  return 'partial';
}

export function countActiveSkillsForItem(
  items: SkillpackBrowserItem[],
  selectedPaths: Iterable<string>,
  item: SkillpackBrowserItem,
): number {
  const selectedSet = new Set(selectedPaths);

  if (item.kind === 'skill') {
    return isSkillActive(selectedSet, item.value) ? 1 : 0;
  }

  return getDescendantSkillItems(items, item.value).filter((skill) =>
    isSkillActive(selectedSet, skill.value),
  ).length;
}

export function getDescendantSkills(
  items: SkillpackBrowserItem[],
  item: SkillpackBrowserItem,
): SkillpackBrowserItem[] {
  return item.kind === 'skill'
    ? [item]
    : getDescendantSkillItems(items, item.value);
}
