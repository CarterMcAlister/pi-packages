import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SKILL_FILE_NAME } from './constants';
import { resolveSkillpackDirectory } from './paths';

export interface SkillpackTarget {
  value: string;
  skillCount: number;
  kind: 'group' | 'skill';
}

interface ScanResult {
  skillPaths: string[];
  targets: SkillpackTarget[];
  totalSkills: number;
  containsSkill: boolean;
}

async function scanDirectory(
  absoluteDir: string,
  relativeDir = '',
): Promise<ScanResult> {
  let entries: Dirent[];

  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;

    if (errno.code === 'ENOENT') {
      return {
        skillPaths: [],
        targets: [],
        totalSkills: 0,
        containsSkill: false,
      };
    }

    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  const containsSkill = entries.some(
    (entry) => entry.isFile() && entry.name === SKILL_FILE_NAME,
  );
  const childDirectories = entries.filter((entry) => entry.isDirectory());

  const childResults = await Promise.all(
    childDirectories.map(async (entry) => {
      const childRelative = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      return scanDirectory(join(absoluteDir, entry.name), childRelative);
    }),
  );

  const skillPaths = [
    ...(containsSkill ? [join(absoluteDir, SKILL_FILE_NAME)] : []),
    ...childResults.flatMap((child) => child.skillPaths),
  ].sort((left, right) => left.localeCompare(right));

  const totalSkills = skillPaths.length;
  const targets = childResults.flatMap((child) => child.targets);

  if (relativeDir && totalSkills > 0) {
    targets.unshift({
      value: relativeDir,
      skillCount: totalSkills,
      kind: containsSkill ? 'skill' : 'group',
    });
  }

  return {
    skillPaths,
    targets,
    totalSkills,
    containsSkill,
  };
}

export async function discoverSkillEntryPoints(
  absoluteDir: string,
): Promise<string[]> {
  return (await scanDirectory(absoluteDir)).skillPaths;
}

export async function resolveSelectedSkillEntryPoints(
  rootDir: string,
  selectedPaths: Iterable<string>,
): Promise<string[]> {
  const uniqueSkillPaths = new Set<string>();

  for (const selectedPath of selectedPaths) {
    const { absolutePath } = resolveSkillpackDirectory(rootDir, selectedPath);

    for (const skillPath of await discoverSkillEntryPoints(absolutePath)) {
      uniqueSkillPaths.add(skillPath);
    }
  }

  return Array.from(uniqueSkillPaths).sort((left, right) =>
    left.localeCompare(right),
  );
}

export async function listSelectableSkillpackTargets(
  rootDir: string,
): Promise<SkillpackTarget[]> {
  return (await scanDirectory(rootDir)).targets.sort((left, right) =>
    left.value.localeCompare(right.value),
  );
}
