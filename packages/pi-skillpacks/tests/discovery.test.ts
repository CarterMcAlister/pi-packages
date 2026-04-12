import { afterEach, beforeEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  discoverSkillEntryPoints,
  listSelectableSkillpackTargets,
  resolveSelectedSkillEntryPoints,
} from '../src/discovery';
import {
  createTempSkillpackRoot,
  removeTempDir,
  toRelativePaths,
  writeSkill,
} from './support/skillpack-fixtures';

let rootDir = '';

beforeEach(async () => {
  rootDir = await createTempSkillpackRoot();
  await writeSkill(rootDir, 'superpowers/agent-browser');
  await writeSkill(rootDir, 'superpowers/planner');
  await writeSkill(rootDir, 'design-tools/palette');
});

afterEach(async () => {
  await removeTempDir(rootDir);
});

test('discoverSkillEntryPoints finds SKILL.md files recursively', async () => {
  const skillPaths = await discoverSkillEntryPoints(
    join(rootDir, 'superpowers'),
  );

  expect(toRelativePaths(rootDir, skillPaths)).toEqual([
    'superpowers/agent-browser/SKILL.md',
    'superpowers/planner/SKILL.md',
  ]);
});

test('resolveSelectedSkillEntryPoints dedupes overlapping selections', async () => {
  const skillPaths = await resolveSelectedSkillEntryPoints(rootDir, [
    'superpowers',
    'superpowers/agent-browser',
  ]);

  expect(toRelativePaths(rootDir, skillPaths)).toEqual([
    'superpowers/agent-browser/SKILL.md',
    'superpowers/planner/SKILL.md',
  ]);
});

test('discoverSkillEntryPoints returns empty array for non-existent directory', async () => {
  const skillPaths = await discoverSkillEntryPoints(
    join(rootDir, 'does-not-exist'),
  );

  expect(skillPaths).toEqual([]);
});

test('resolveSelectedSkillEntryPoints returns empty array when selected path does not exist', async () => {
  const skillPaths = await resolveSelectedSkillEntryPoints(rootDir, [
    'does-not-exist',
  ]);

  expect(skillPaths).toEqual([]);
});

test('listSelectableSkillpackTargets returns empty array for non-existent root', async () => {
  const targets = await listSelectableSkillpackTargets(
    join(rootDir, 'does-not-exist'),
  );

  expect(targets).toEqual([]);
});

test('listSelectableSkillpackTargets returns group and leaf targets', async () => {
  const targets = await listSelectableSkillpackTargets(rootDir);

  expect(targets).toEqual([
    { value: 'design-tools', skillCount: 1, kind: 'group' },
    { value: 'design-tools/palette', skillCount: 1, kind: 'skill' },
    { value: 'superpowers', skillCount: 2, kind: 'group' },
    { value: 'superpowers/agent-browser', skillCount: 1, kind: 'skill' },
    { value: 'superpowers/planner', skillCount: 1, kind: 'skill' },
  ]);
});
