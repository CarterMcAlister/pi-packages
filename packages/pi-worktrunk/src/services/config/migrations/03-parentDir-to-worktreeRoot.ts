import type { Migration } from '@zenobius/pi-extension-config';

type AnyRecord = Record<string, unknown>;

type LegacyWorktreeSettings = {
  worktreeRoot?: unknown;
  parentDir?: unknown;
  onCreate?: unknown;
};

function toRecord(value: unknown): AnyRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...(value as AnyRecord) };
}

function migrateSettings(value: unknown): LegacyWorktreeSettings {
  const source = toRecord(value);
  const next: LegacyWorktreeSettings = {};

  if (source.worktreeRoot !== undefined) {
    next.worktreeRoot = source.worktreeRoot;
  } else if (source.parentDir !== undefined) {
    next.worktreeRoot = source.parentDir;
  }

  if (source.onCreate !== undefined) {
    next.onCreate = source.onCreate;
  }

  return next;
}

export const migration: Migration = {
  id: 'parentDir-to-worktreeRoot',
  up(config: unknown): AnyRecord {
    const record = toRecord(config);
    const next = { ...record };

    const worktrees = toRecord(record.worktrees);
    const migratedEntries = Object.entries(worktrees).map(
      ([pattern, value]) => [pattern, migrateSettings(value)],
    );

    if (migratedEntries.length > 0) {
      next.worktrees = Object.fromEntries(migratedEntries);
    }

    if (record.worktree !== undefined) {
      next.worktree = migrateSettings(record.worktree);
    }

    return next;
  },
  down(config: unknown): AnyRecord {
    const record = toRecord(config);
    const next = { ...record };

    const worktrees = toRecord(record.worktrees);
    const downgradedEntries = Object.entries(worktrees).map(
      ([pattern, value]) => {
        const migrated = migrateSettings(value);
        const downSettings: AnyRecord = {};

        if (migrated.worktreeRoot !== undefined) {
          downSettings.parentDir = migrated.worktreeRoot;
        }

        if (migrated.onCreate !== undefined) {
          downSettings.onCreate = migrated.onCreate;
        }

        return [pattern, downSettings];
      },
    );

    if (downgradedEntries.length > 0) {
      next.worktrees = Object.fromEntries(downgradedEntries);
    }

    if (record.worktree !== undefined) {
      const migrated = migrateSettings(record.worktree);
      const downSettings: AnyRecord = {};

      if (migrated.worktreeRoot !== undefined) {
        downSettings.parentDir = migrated.worktreeRoot;
      }

      if (migrated.onCreate !== undefined) {
        downSettings.onCreate = migrated.onCreate;
      }

      next.worktree = downSettings;
    }

    return next;
  },
};
