import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MockAppShell } from '@/core/updates/AppShell.mock';
import type { Container } from '@/dependency/container/container.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import { createApp } from '@/interface/http/app';

describe('The update banner through the API', () => {
  const shell = new MockAppShell();
  let container: Container;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    container = createTestContainer({ appShell: shell });
    app = createApp(container, '/nonexistent', () => 3000);
  });

  afterAll(() => container.close());

  const waiting = async () =>
    ((await (await app.request('/api/app/update')).json()) as { update: unknown }).update;
  const restart = () => app.request('/api/app/update/restart', { method: 'POST' });

  test('no update: no banner, and no restart', async () => {
    expect(await waiting()).toBeNull();
    expect((await restart()).status).toBe(422);
    expect(shell.restarts).toBe(0);
  });

  test('an installed update shows, and one click restarts into it', async () => {
    container.appUpdateService.ready('0.5.0');

    expect(await waiting()).toEqual({ version: '0.5.0' });
    expect((await restart()).status).toBe(202);
    expect(shell.restarts).toBe(1);
  });
});
