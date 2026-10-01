import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { Category, ItemKind, ItemState } from '@/core/items/Item.types';
import { PairingState } from '@/core/services/ConnectionService/ConnectionService.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_SIGNAL_ACCOUNT,
  MOCK_SIGNAL_DM,
  MOCK_SIGNAL_LINK,
  MockSignalClient,
} from '@/infrastructure/clients/SignalClient/SignalClient.mock';

/** Pairing and envelopes are handled asynchronously; let them land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('Signal connector end to end', () => {
  const signal = new MockSignalClient();
  let container: Container;
  let connectionId: string;

  const open = () => container.inboxService.list({ state: ItemState.Open, connectionId });

  beforeAll(() => {
    container = createTestContainer({ signalClient: signal });
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('scanning the code creates the connection, named after the number', async () => {
    const start = await container.connectionService.beginPairing({ kind: ConnectorKind.Signal });

    expect(start.code).toBe(MOCK_SIGNAL_LINK);
    await settle();

    const status = container.connectionService.pairingStatus(start.pairingId);

    expect(status.state).toBe(PairingState.Linked);
    expect(status.connection?.name).toBe(MOCK_SIGNAL_ACCOUNT);
    connectionId = status.connection?.id ?? '';
    const linked = await container.connectionService.get(connectionId);

    expect(linked?.status).toBe(ConnectionStatus.Running);
    // A live connection, not "never synced": nothing to poll, but the link is up.
    expect(linked?.lastSyncAt).toBeInstanceOf(Date);
  });

  test('a direct message comes in as Important; a reply quotes it', async () => {
    signal.deliver(MOCK_SIGNAL_DM);
    await settle();

    const [item] = await open();

    expect(item?.kind).toBe(ItemKind.DirectMessage);
    expect(item?.title).toBe('Petra in a direct message');
    expect(item?.category).toBe(Category.Important);

    const replied = await container.inboxService.reply(item?.id ?? '', 'Yes, 6 pm.');

    expect(replied.state).toBe(ItemState.Done);
    expect(signal.sent.at(-1)).toEqual({
      target: { recipient: 'uuid-petra' },
      text: 'Yes, 6 pm.',
      quote: { timestamp: MOCK_SIGNAL_DM.timestamp, author: 'uuid-petra' },
    });
  });

  test('group chatter waits Undecided; a mention of me is Important and reads @names', async () => {
    const inGroup = (timestamp: number, message: string, mentionMe: boolean) => ({
      ...MOCK_SIGNAL_DM,
      timestamp,
      dataMessage: {
        timestamp,
        message,
        groupInfo: { groupId: 'group-family' },
        mentions: mentionMe
          ? [{ number: MOCK_SIGNAL_ACCOUNT, name: 'Jozef', start: 0, length: 1 }]
          : [],
      },
    });

    signal.deliver(inGroup(1759046600000, 'Who brings the cake?', false));
    signal.deliver(inGroup(1759046700000, '￼ can you drive?', true));
    await settle();

    const items = await open();
    const mention = items.find((item) => item.kind === ItemKind.Mention);

    expect(items).toHaveLength(2);
    expect(mention?.body).toBe('@Jozef can you drive?');
    expect(mention?.title).toBe('Petra in Family');
    expect(mention?.category).toBe(Category.Important);
    expect(items.find((item) => item.kind === ItemKind.Message)?.category).toBe(Category.Undecided);
  });

  test('reading on the phone or answering there clears it here', async () => {
    signal.deliver({
      ...MOCK_SIGNAL_DM,
      dataMessage: undefined,
      syncMessage: {
        readMessages: [{ senderUuid: 'uuid-petra', timestamp: 1759046600000 }],
      },
    });
    await settle();

    expect((await open()).map((item) => item.body)).toEqual(['@Jozef can you drive?']);

    signal.deliver({
      ...MOCK_SIGNAL_DM,
      sourceUuid: 'uuid-me',
      sourceNumber: MOCK_SIGNAL_ACCOUNT,
      dataMessage: undefined,
      syncMessage: {
        sentMessage: {
          timestamp: 1759046800000,
          message: 'Sure',
          groupInfo: { groupId: 'group-family' },
        },
      },
    });
    await settle();

    expect(await open()).toHaveLength(0);
  });

  test('an edited message replaces its text instead of adding an item', async () => {
    signal.deliver({
      ...MOCK_SIGNAL_DM,
      timestamp: 1759046900000,
      dataMessage: { timestamp: 1759046900000, message: 'See you at 5' },
    });
    signal.deliver({
      ...MOCK_SIGNAL_DM,
      timestamp: 1759046950000,
      dataMessage: undefined,
      editMessage: {
        targetSentTimestamp: 1759046900000,
        dataMessage: { timestamp: 1759046950000, message: 'See you at 6' },
      },
    });
    await settle();

    expect((await open()).map((item) => item.body)).toEqual(['See you at 6']);
  });
});
