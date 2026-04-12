import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
  ADD_COMMAND,
  REMOVE_COMMAND,
  SKILLPACKS_COMMAND,
  STATE_ENTRY_TYPE,
} from '../src/constants';
import skillpackSessionLoader, {
  createSkillpackSessionLoader,
} from '../src/skillpack-session-loader';
import {
  createTempSkillpackRoot,
  removeTempDir,
  toRelativePaths,
  writeSkill,
} from './support/skillpack-fixtures';

type Handler = (
  event: unknown,
  ctx: ExtensionContext,
) => Promise<unknown> | unknown;

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionContext) => Promise<unknown> | unknown;
};

function createFakePi() {
  const commands = new Map<string, RegisteredCommand>();
  const events = new Map<string, Handler>();
  const appended: Array<{ customType: string; data: unknown }> = [];

  const api = {
    on(eventName: string, handler: Handler) {
      events.set(eventName, handler);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command as RegisteredCommand);
    },
    appendEntry(customType: string, data: unknown) {
      appended.push({ customType, data });
    },
  } as unknown as ExtensionAPI;

  return {
    commands,
    events,
    appended,
    api,
  };
}

function createCommandContext(
  branchEntries: unknown[],
  options: { customResult?: string[] | null } = {},
) {
  const notifications: Array<{ message: string; level: string }> = [];
  let reloaded = false;

  const ctx = {
    sessionManager: {
      getBranch: () => branchEntries,
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      custom: async () => options.customResult ?? null,
    },
    reload: async () => {
      reloaded = true;
    },
  } as unknown as ExtensionContext;

  return {
    notifications,
    get reloaded() {
      return reloaded;
    },
    ctx,
  };
}

let rootDir = '';

beforeEach(async () => {
  rootDir = await createTempSkillpackRoot();
  await writeSkill(rootDir, 'superpowers/agent-browser');
  await writeSkill(rootDir, 'superpowers/planner');
  await mkdir(join(rootDir, 'empty-pack'), { recursive: true });
});

afterEach(async () => {
  await removeTempDir(rootDir);
});

test('default export is a function', () => {
  expect(typeof skillpackSessionLoader).toBe('function');
});

test('registers expected commands and events', () => {
  const fakePi = createFakePi();

  createSkillpackSessionLoader({ rootDir })(fakePi.api);

  expect(fakePi.commands.has(ADD_COMMAND)).toBe(true);
  expect(fakePi.commands.has(REMOVE_COMMAND)).toBe(true);
  expect(fakePi.commands.has(SKILLPACKS_COMMAND)).toBe(true);
  expect(fakePi.events.has('session_start')).toBe(true);
  expect(fakePi.events.has('session_tree')).toBe(true);
  expect(fakePi.events.has('resources_discover')).toBe(true);
});

test('skillpack-add persists the selected path and reloads the runtime', async () => {
  const fakePi = createFakePi();
  createSkillpackSessionLoader({ rootDir })(fakePi.api);

  const addCommand = fakePi.commands.get(ADD_COMMAND);
  const context = createCommandContext([]);

  expect(addCommand).toBeDefined();

  if (!addCommand) {
    throw new Error('Expected skillpack-add command to be registered');
  }

  await addCommand.handler('superpowers', context.ctx);

  expect(fakePi.appended).toEqual([
    {
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['superpowers'] },
    },
  ]);
  expect(context.reloaded).toBe(true);
  expect(context.notifications.at(-1)).toEqual({
    message: 'Added "superpowers" (2 skills). Reloading…',
    level: 'info',
  });
});

test('skillpack-add warns when the directory contains no skills', async () => {
  const fakePi = createFakePi();
  createSkillpackSessionLoader({ rootDir })(fakePi.api);

  const addCommand = fakePi.commands.get(ADD_COMMAND);
  const context = createCommandContext([]);

  expect(addCommand).toBeDefined();

  if (!addCommand) {
    throw new Error('Expected skillpack-add command to be registered');
  }

  await addCommand.handler('empty-pack', context.ctx);

  expect(context.reloaded).toBe(false);
  expect(fakePi.appended).toEqual([]);
  expect(context.notifications.at(-1)).toEqual({
    message: 'No skills found under "empty-pack".',
    level: 'warning',
  });
});

test('skillpack-remove persists the remaining selections and reloads', async () => {
  const fakePi = createFakePi();
  createSkillpackSessionLoader({ rootDir })(fakePi.api);

  const removeCommand = fakePi.commands.get(REMOVE_COMMAND);
  const context = createCommandContext([
    {
      type: 'custom',
      customType: STATE_ENTRY_TYPE,
      data: {
        selectedPaths: ['superpowers', 'superpowers/agent-browser'],
      },
    },
  ]);

  expect(removeCommand).toBeDefined();

  if (!removeCommand) {
    throw new Error('Expected skillpack-remove command to be registered');
  }

  await removeCommand.handler('superpowers/agent-browser', context.ctx);

  expect(fakePi.appended).toEqual([
    {
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['superpowers'] },
    },
  ]);
  expect(context.reloaded).toBe(true);
  expect(context.notifications.at(-1)).toEqual({
    message:
      'Removed "superpowers/agent-browser" (1 selection remaining). Reloading…',
    level: 'info',
  });
});

test('skillpack-remove warns when the path is not active', async () => {
  const fakePi = createFakePi();
  createSkillpackSessionLoader({ rootDir })(fakePi.api);

  const removeCommand = fakePi.commands.get(REMOVE_COMMAND);
  const context = createCommandContext([]);

  expect(removeCommand).toBeDefined();

  if (!removeCommand) {
    throw new Error('Expected skillpack-remove command to be registered');
  }

  await removeCommand.handler('superpowers', context.ctx);

  expect(context.reloaded).toBe(false);
  expect(context.notifications.at(-1)).toEqual({
    message: '"superpowers" is not active in this session.',
    level: 'warning',
  });
});

test('skillpacks command persists the selections returned by the UI and reloads', async () => {
  const fakePi = createFakePi();
  createSkillpackSessionLoader({ rootDir })(fakePi.api);

  const skillpacksCommand = fakePi.commands.get(SKILLPACKS_COMMAND);
  const context = createCommandContext([], { customResult: ['superpowers'] });

  expect(skillpacksCommand).toBeDefined();

  if (!skillpacksCommand) {
    throw new Error('Expected skillpacks command to be registered');
  }

  await skillpacksCommand.handler('', context.ctx);

  expect(fakePi.appended).toEqual([
    {
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['superpowers'] },
    },
  ]);
  expect(context.reloaded).toBe(true);
  expect(context.notifications.at(-1)).toEqual({
    message: 'Updated skillpack selections (1 selection). Reloading…',
    level: 'info',
  });
});

test('resources_discover returns the union of overlapping selections', async () => {
  const fakePi = createFakePi();
  createSkillpackSessionLoader({ rootDir })(fakePi.api);

  const resourcesDiscover = fakePi.events.get('resources_discover');
  const context = createCommandContext([
    {
      type: 'custom',
      customType: STATE_ENTRY_TYPE,
      data: {
        selectedPaths: ['superpowers', 'superpowers/agent-browser'],
      },
    },
  ]);

  expect(resourcesDiscover).toBeDefined();

  if (!resourcesDiscover) {
    throw new Error('Expected resources_discover handler to be registered');
  }

  const result = await resourcesDiscover({ reason: 'startup' }, context.ctx);

  expect(
    toRelativePaths(rootDir, (result as { skillPaths: string[] }).skillPaths),
  ).toEqual([
    'superpowers/agent-browser/SKILL.md',
    'superpowers/planner/SKILL.md',
  ]);
});
