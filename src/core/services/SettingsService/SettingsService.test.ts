import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ErrorCode } from '@/core/errors/errors';
import { DEFAULT_QUICK_REACTIONS } from '@/core/settings/quickReactions';
import { Theme } from '@/core/settings/Settings.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';

describe('SettingsService', () => {
  let container: Container;

  beforeAll(() => {
    container = createTestContainer();
  });

  afterAll(() => {
    container.close();
  });

  test('starts with the system theme and the default quick reactions', async () => {
    expect(await container.settingsService.get()).toEqual({
      theme: Theme.System,
      quickReactions: [...DEFAULT_QUICK_REACTIONS],
    });
  });

  test('changes only what it is given, and remembers it', async () => {
    await container.settingsService.update({ theme: Theme.Light });
    await container.settingsService.update({ quickReactions: ['✅', '🫥', '👍🏽'] });

    expect(await container.settingsService.get()).toEqual({
      theme: Theme.Light,
      quickReactions: ['✅', '🫥', '👍🏽'],
    });
  });

  test('refuses what is not an emoji, repeats, and an empty or overlong row', async () => {
    const refused = (quickReactions: string[], message: string) =>
      expect(container.settingsService.update({ quickReactions })).rejects.toMatchObject({
        code: ErrorCode.Validation,
        message: expect.stringContaining(message) as unknown as string,
      });

    await refused(['✅', 'a'], 'Not an emoji Huginn can react with: a');
    await refused(['❤️', '❤'], 'Each emoji only once');
    await refused([], 'Between 1 and 8');
    await refused(['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂'], 'Between 1 and 8');
  });
});
