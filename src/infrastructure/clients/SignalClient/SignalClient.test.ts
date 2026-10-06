import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SignalEnvelope } from '@/core/clients/SignalClient/SignalClient.types';
import { createTestLogger } from '@/dependency/container/testContainer';
import { SignalRpcClient } from './SignalClient';

const ACCOUNT = '+420600000001';
const FAKE = join(import.meta.dir, 'fakeSignalCli.ts');

const waitFor = async (check: () => boolean | Promise<boolean>, timeoutMs = 4_000) => {
  const deadline = Date.now() + timeoutMs;

  while (!(await check())) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }

    await Bun.sleep(10);
  }
};

describe('SignalRpcClient runs signal-cli itself', () => {
  const clients: SignalRpcClient[] = [];
  const folders: string[] = [];

  /** A client whose signal-cli is the fake, in a folder of its own. */
  const setUp = async (options: { crash?: boolean } = {}) => {
    const folder = await mkdtemp(join(tmpdir(), 'huginn-signal-'));
    const cli = join(folder, 'signal-cli');
    const log = join(folder, 'calls.log');

    await writeFile(
      cli,
      `#!/bin/sh\nFAKE_SIGNAL_LOG='${log}' FAKE_SIGNAL_CRASH=${options.crash ? 1 : 0} exec '${process.execPath}' '${FAKE}' "$@"\n`
    );
    await chmod(cli, 0o755);

    const client = new SignalRpcClient(createTestLogger(), {
      cli,
      dataDir: join(folder, 'signal'),
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

  test('starts it on first use, with its own private data folder and manual receiving', async () => {
    const { client, folder, calls } = await setUp();

    expect(client.isAvailable()).toBe(true);
    expect(await client.accounts()).toEqual([ACCOUNT]);

    const [start] = await calls();

    expect(start).toBe(
      `start --config ${join(folder, 'signal')} jsonRpc --receive-mode=manual --ignore-attachments --ignore-stories --ignore-avatars --ignore-stickers`
    );
    expect((await stat(join(folder, 'signal'))).mode & 0o777).toBe(0o700);
  });

  test("hands a subscription's messages to the account's connection", async () => {
    const { client } = await setUp();
    const received: SignalEnvelope[] = [];

    await client.subscribe(ACCOUNT, (envelope) => received.push(envelope));
    await waitFor(() => received.length === 1);

    expect(received[0]?.dataMessage?.message).toBe('Hi');
  });

  test('when the last connection stops listening, messages wait on the server again', async () => {
    const { client, calls } = await setUp();

    await client.subscribe(ACCOUNT, () => undefined);
    client.unsubscribe(ACCOUNT);

    await waitFor(async () =>
      (await calls()).includes('call unsubscribeReceive {"subscription":0}')
    );
  });

  test('starts it again after a crash and subscribes again', async () => {
    const { client, calls } = await setUp({ crash: true });
    const received: SignalEnvelope[] = [];

    await client.subscribe(ACCOUNT, (envelope) => received.push(envelope));
    await waitFor(() => received.length === 2);

    const log = await calls();

    expect(log.filter((line) => line.startsWith('start '))).toHaveLength(2);
    expect(log.filter((line) => line.startsWith('call subscribeReceive'))).toHaveLength(2);
  });

  test('close stops it with SIGTERM, so it can save and exit cleanly', async () => {
    const { client, calls } = await setUp();

    await client.accounts();
    await client.close();

    expect(await calls()).toContain('sigterm');
  });

  test('without signal-cli it says how to install it', async () => {
    const client = new SignalRpcClient(createTestLogger(), {
      cli: '/nowhere/signal-cli',
      dataDir: join(tmpdir(), 'huginn-signal-never-created'),
      restartBackoffMs: [10],
    });

    expect(client.isAvailable()).toBe(false);
    await expect(client.startLink()).rejects.toThrow('brew install signal-cli');
  });
});
