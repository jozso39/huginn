import { afterEach, describe, expect, test } from 'bun:test';
import type { AppInfo } from '@/core/updates/AppUpdate.types';
import { UpdateState } from '@/core/updates/AppUpdate.types';
import { MockAppShell } from '@/core/updates/AppShell.mock';
import type { Container } from '@/dependency/container/container.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import { createApp } from '@/interface/http/app';

describe('Settings → Updates and the update strip, through the API', () => {
  let container: Container;

  afterEach(() => container.close());

  const setUp = async (shell: MockAppShell | null) => {
    container = createTestContainer(shell ? { appShell: shell } : {});
    await container.appUpdateService.start();

    const app = createApp(container, '/nonexistent', () => 3000);
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`/api/app${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      });
    const info = async () => ((await (await call('GET', '')).json()) as { app: AppInfo }).app;

    return { call, info };
  };

  test('the version, where its changes are listed, and that nothing was checked yet', async () => {
    const { info } = await setUp(new MockAppShell());

    expect(await info()).toMatchObject({
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      releasesUrl: 'https://github.com/jozso39/huginn/releases',
      updatable: true,
      automatic: true,
      status: { state: UpdateState.Idle },
    });
  });

  test('switching automatic updates off is kept and told to the Mac app', async () => {
    const shell = new MockAppShell();
    const { call, info } = await setUp(shell);
    const response = await call('PUT', '/updates', { automatic: false });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { app: AppInfo }).app.automatic).toBe(false);
    expect((await info()).automatic).toBe(false);
    expect(shell.automatic).toEqual([true, false]);
    expect((await call('PUT', '/updates', { automatic: 'no' })).status).toBe(400);
  });

  test('check, then install what it found, then restart into it', async () => {
    const shell = new MockAppShell();
    const { call } = await setUp(shell);

    expect((await call('POST', '/updates/check')).status).toBe(202);
    expect(shell.checks).toBe(1);

    expect((await call('POST', '/updates/install')).status).toBe(422);
    container.appUpdateService.statusChanged({
      state: UpdateState.Available,
      version: '0.7.0',
      error: null,
    });
    expect((await call('POST', '/updates/install')).status).toBe(202);
    expect(shell.installs).toBe(1);

    expect((await call('POST', '/updates/restart')).status).toBe(422);
    container.appUpdateService.statusChanged({
      state: UpdateState.Ready,
      version: '0.7.0',
      error: null,
    });
    expect((await call('POST', '/updates/restart')).status).toBe(202);
    expect(shell.restarts).toBe(1);
  });

  test("what's new shows once per version", async () => {
    const { call, info } = await setUp(new MockAppShell());
    const { version } = await info();

    expect((await info()).whatsNew).toBe(version);
    expect((await call('POST', '/whats-new/dismiss')).status).toBe(200);
    expect((await info()).whatsNew).toBeNull();
  });

  test('without the Mac app: a version, no updates', async () => {
    const { call, info } = await setUp(null);

    expect((await info()).updatable).toBe(false);
    expect((await call('POST', '/updates/check')).status).toBe(422);
  });
});
