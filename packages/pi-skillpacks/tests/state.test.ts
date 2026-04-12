import { expect, test } from 'bun:test';
import { STATE_ENTRY_TYPE } from '../src/constants';
import {
  createSkillpackState,
  restoreSelectedPathsFromEntries,
} from '../src/state';

test('createSkillpackState sorts and dedupes selected paths', () => {
  expect(
    createSkillpackState([
      'superpowers/agent-browser',
      'superpowers',
      'superpowers',
    ]),
  ).toEqual({ selectedPaths: ['superpowers', 'superpowers/agent-browser'] });
});

test('restoreSelectedPathsFromEntries returns an empty array when no state exists', () => {
  expect(restoreSelectedPathsFromEntries([])).toEqual([]);
});

test('restoreSelectedPathsFromEntries uses the latest valid state entry', () => {
  const entries = [
    {
      type: 'custom',
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['superpowers'] },
    },
    {
      type: 'custom',
      customType: 'other-state',
      data: { selectedPaths: ['ignored'] },
    },
    {
      type: 'custom',
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['design-tools', 'superpowers'] },
    },
  ];

  expect(restoreSelectedPathsFromEntries(entries)).toEqual([
    'design-tools',
    'superpowers',
  ]);
});

test('restoreSelectedPathsFromEntries skips malformed newer entries', () => {
  const entries = [
    {
      type: 'custom',
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: ['superpowers'] },
    },
    {
      type: 'custom',
      customType: STATE_ENTRY_TYPE,
      data: { selectedPaths: [42] },
    },
  ];

  expect(restoreSelectedPathsFromEntries(entries)).toEqual(['superpowers']);
});
