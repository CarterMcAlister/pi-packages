import { expect, test } from 'bun:test';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import extension from '../src/skillpack-session-loader';

test('registers without throwing', () => {
  const pi = {
    on() {},
    registerCommand() {},
  } as unknown as ExtensionAPI;

  expect(() => extension(pi)).not.toThrow();
});
