import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessengerEvent } from '@/core/clients/MessengerClient/MessengerClient.types';
import { MessengerEventType } from '@/core/clients/MessengerClient/MessengerClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { createTestLogger } from '@/dependency/container/testContainer';
import { HelperMessengerClient } from './MessengerClient';

const FAKE = join(import.meta.dir, 'fakeMessengerHelper.ts');
const COOKIES = { xs: 'xs-1', c_user: '100000001', datr: 'datr-1' };

const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs = 4_000) => {
  const deadline = Date.now() + timeoutMs;

  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }

    await Bun.sleep(10);
  }
};

describe('HelperMessengerClient runs huginn-messenger itself', () => {
  const clients: HelperMessengerClient[] = [];
  const folders: string[] = [];

  /** A client whose helper is the fake, in a folder of its own. */
  const setUp = async (options: { crash?: boolean; missing?: boolean } = {}) => {
    const folder = await mkdtemp(join(tmpdir(), 'huginn-messenger-'));
    const helper = join(folder, 'huginn-messenger');
    const log = join(folder, 'calls.log');

    if (!options.missing) {
      await writeFile(
        helper,
        `#!/bin/sh\nFAKE_MESSENGER_LOG='${log}' FAKE_MESSENGER_CRASH=${options.crash ? 1 : 0} exec '${process.execPath}' '${FAKE}' "$@"\n`
      );
      await chmod(helper, 0o755);
    }

    const client = new HelperMessengerClient(createTestLogger(), {
      helper,
      dataDir: join(folder, 'messenger'),
      restartBackoffMs: [10],
    });

    clients.push(client);
    folders.push(folder);

    const calls = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n');

    return { client, folder, calls };
  };

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true })));
  });

  test('asks the helper which browser to pose as, once, and lets it go', async () => {
    const { client, folder, calls } = await setUp();

    expect(client.isAvailable()).toBe(true);
    expect(await client.userAgent()).toBe('Mozilla/5.0 (fake) Chrome/141');
    expect(await client.userAgent()).toBe('Mozilla/5.0 (fake) Chrome/141');
    await waitFor(async () => (await calls()).includes('stdin closed'));
    expect((await calls()).filter((line) => line.startsWith('start'))).toEqual([
      `start --data ${join(folder, 'messenger')}`,
    ]);
    // The device keys' folder is private.
    expect((await stat(join(folder, 'messenger'))).mode & 0o777).toBe(0o700);
  });

  test('a login returns the account and the cookies to keep; dead cookies are Unauthorized', async () => {
    const { client } = await setUp();

    expect(await client.login(COOKIES)).toEqual({
      userId: '100000001',
      name: 'Jozef',
      cookies: { ...COOKIES, fr: 'fr-1' },
    });

    const refused = await client.login({ ...COOKIES, xs: 'dead' }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(HuginnError);
    expect((refused as HuginnError).code).toBe(ErrorCode.Unauthorized);
  });

  test('a session connects, hands on its events and stops the helper with it', async () => {
    const { client, calls } = await setUp();
    const events: MessengerEvent[] = [];
    const session = client.session(COOKIES);

    expect(await session.start((event) => events.push(event))).toEqual({
      userId: '100000001',
      name: 'Jozef',
    });
    await waitFor(() => events.length === 3);
    // Events it does not know are skipped, not fatal.
    expect(events.map((event) => event.type)).toEqual([
      MessengerEventType.Connected,
      MessengerEventType.Message,
      MessengerEventType.Cookies,
    ]);
    expect(events[1]).toMatchObject({
      message: { senderName: 'Petra', sentAt: new Date(1761066000000), initial: true },
    });

    await session.stop();
    expect(await calls()).toContain('stdin closed');
  });

  test('a session whose cookies Facebook refuses rejects as Unauthorized', async () => {
    const { client } = await setUp();
    const failed = await client
      .session({ ...COOKIES, xs: 'dead' })
      .start(() => undefined)
      .catch((error: unknown) => error);

    expect((failed as HuginnError).code).toBe(ErrorCode.Unauthorized);
  });

  test('a helper that dies is started again, with the newest cookies', async () => {
    const { client, calls } = await setUp({ crash: true });
    const events: MessengerEvent[] = [];

    await client.session(COOKIES).start((event) => events.push(event));
    await waitFor(
      async () => (await calls()).filter((line) => line.startsWith('call connect')).length === 2
    );

    const connects = (await calls()).filter((line) => line.startsWith('call connect'));

    expect(connects[1]).toContain('"xs":"xs-2"');
    expect(events.map((event) => event.type)).toContain(MessengerEventType.Disconnected);
  });

  test('is unavailable when the helper is missing', async () => {
    const { client } = await setUp({ missing: true });

    expect(client.isAvailable()).toBe(false);
    expect(client.login(COOKIES)).rejects.toThrow('helper is missing');
  });
});
