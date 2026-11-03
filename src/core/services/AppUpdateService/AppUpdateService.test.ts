import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HuginnEvent } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import { UpdateState } from '@/core/updates/AppUpdate.types';
import { MockAppShell } from '@/core/updates/AppShell.mock';
import type { Container } from '@/dependency/container/container.types';
import type { CreateTestContainerOptions } from '@/dependency/container/testContainer';
import { createTestContainer } from '@/dependency/container/testContainer';

describe("Huginn's version and its updates", () => {
  const containers: Container[] = [];
  const folders: string[] = [];

  afterEach(async () => {
    containers.splice(0).forEach((container) => container.close());
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true })));
  });

  const start = async (options: CreateTestContainerOptions = {}) => {
    const container = createTestContainer(options);
    const events: HuginnEvent[] = [];

    containers.push(container);
    container.eventBus.subscribe((event) => events.push(event));
    await container.appUpdateService.start();

    return { service: container.appUpdateService, events, container };
  };

  const report = (
    state: UpdateState,
    version: string | null = null,
    error: string | null = null
  ) => ({
    state,
    version,
    error,
  });

  test('tells the Mac app at start that updates install by themselves, unless switched off', async () => {
    const shell = new MockAppShell();
    const { service } = await start({ appShell: shell });

    expect(service.info()).toMatchObject({
      updatable: true,
      automatic: true,
      status: { state: UpdateState.Idle, version: null, error: null, at: null },
    });
    expect(shell.automatic).toEqual([true]);

    expect((await service.setAutomatic(false)).automatic).toBe(false);
    expect(shell.automatic).toEqual([true, false]);
  });

  test('the switch is kept: Huginn started again still installs nothing by itself', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'huginn-updates-'));
    const dbPath = join(folder, 'huginn.db');

    folders.push(folder);

    const first = await start({ appShell: new MockAppShell(), dbPath });

    await first.service.setAutomatic(false);
    first.container.close();

    const shell = new MockAppShell();
    const again = await start({ appShell: shell, dbPath });

    expect(again.service.info().automatic).toBe(false);
    expect(shell.automatic).toEqual([false]);
  });

  test('what the Mac app reports reaches the window, with when', async () => {
    const { service, events } = await start({ appShell: new MockAppShell() });

    service.statusChanged(report(UpdateState.Checking));
    service.statusChanged(report(UpdateState.Available, '0.7.0'));

    expect(service.info().status).toMatchObject({ state: UpdateState.Available, version: '0.7.0' });
    expect(service.info().status.at).toBeInstanceOf(Date);
    expect(
      events.map((event) =>
        event.type === HuginnEventType.AppChanged ? event.app.status.state : null
      )
    ).toEqual([UpdateState.Checking, UpdateState.Available]);
  });

  test('a check is asked of the Mac app; Install only once a newer version was found', async () => {
    const shell = new MockAppShell();
    const { service } = await start({ appShell: shell });

    service.check();
    expect(shell.checks).toBe(1);

    expect(() => service.install()).toThrow('no newer version is waiting');
    service.statusChanged(report(UpdateState.Available, '0.7.0'));
    service.install();
    expect(shell.installs).toBe(1);
  });

  test('Restart only once an update is installed', async () => {
    const shell = new MockAppShell();
    const { service } = await start({ appShell: shell });

    expect(() => service.restart()).toThrow('no update is waiting');
    service.statusChanged(report(UpdateState.Installing, '0.7.0'));
    expect(() => service.restart()).toThrow('no update is waiting');

    service.statusChanged(report(UpdateState.Ready, '0.7.0'));
    service.restart();
    expect(shell.restarts).toBe(1);
  });

  test('without the Mac app there is a version, and nothing to check, switch or install', async () => {
    const { service } = await start();

    expect(service.info()).toMatchObject({ updatable: false, version: expect.any(String) });
    expect(() => service.check()).toThrow('updates come with the Mac app');
    expect(() => service.restart()).toThrow('updates come with the Mac app');
    expect(service.setAutomatic(false)).rejects.toThrow('updates come with the Mac app');
  });

  test('a new version shows what is new in it until dismissed; the next one shows again', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'huginn-updates-'));
    const dbPath = join(folder, 'huginn.db');

    folders.push(folder);

    const first = await start({ dbPath, appVersion: '0.7.0' });

    expect(first.service.info().whatsNew).toBe('0.7.0');
    expect((await first.service.dismissWhatsNew()).whatsNew).toBeNull();
    first.container.close();

    const same = await start({ dbPath, appVersion: '0.7.0' });

    expect(same.service.info().whatsNew).toBeNull();
    same.container.close();

    const next = await start({ dbPath, appVersion: '0.8.0' });

    expect(next.service.info()).toMatchObject({ version: '0.8.0', whatsNew: '0.8.0' });
  });
});
