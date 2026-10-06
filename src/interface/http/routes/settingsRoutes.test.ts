import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AiProvider } from '@/core/settings/AiKey.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import { createApp } from '@/interface/http/app';

const KEY = 'sk-or-v1-0123456789abcdef';

describe('The AI key through the API', () => {
  let container: Container;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    container = createTestContainer();
    app = createApp(container, '/nonexistent', () => 3000);
  });

  afterAll(() => {
    container.close();
  });

  const settings = async () =>
    (await (await app.request('/api/settings')).json()) as {
      ai: { provider: string; hint: string } | null;
    };
  const putKey = (provider: string, key: string) =>
    app.request('/api/settings/ai-key', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    });

  test('none at first: the model clients get nothing', async () => {
    expect((await settings()).ai).toBeNull();
    expect(container.settingsService.credentials()).toBeNull();
  });

  test('a key goes in, is checked, and only its provider and last characters come out', async () => {
    const saved = await putKey(AiProvider.OpenRouter, `  ${KEY}  `);

    expect(saved.status).toBe(200);

    const body = await (await app.request('/api/settings')).text();

    expect(body).toContain('"hint":"cdef"');
    expect(body).not.toContain('0123456789ab');
    expect(container.settingsService.credentials()).toEqual({
      provider: AiProvider.OpenRouter,
      apiKey: KEY,
    });
  });

  test('it survives a restart: start() opens the sealed copy again', async () => {
    await container.settingsService.start();

    expect(container.settingsService.credentials()?.apiKey).toBe(KEY);
  });

  test('a key the provider refuses is not kept, and the earlier one stays', async () => {
    const refused = await putKey(AiProvider.TypeSafe, 'ts-refused-0123456789');

    expect(refused.status).toBe(400);
    expect((await settings()).ai?.provider).toBe(AiProvider.OpenRouter);
  });

  test('removing it leaves Huginn without one, also after a restart', async () => {
    const removed = await app.request('/api/settings/ai-key', { method: 'DELETE' });

    expect(removed.status).toBe(200);
    await container.settingsService.start();
    expect((await settings()).ai).toBeNull();
    expect(container.settingsService.credentials()).toBeNull();
  });
});
