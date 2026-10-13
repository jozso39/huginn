import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { WhatsAppEventType } from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { Category, ItemKind, ItemState } from '@/core/items/Item.types';
import { PairingState } from '@/core/services/ConnectionService/ConnectionService.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_WHATSAPP_CODE,
  MOCK_WHATSAPP_DM,
  MOCK_WHATSAPP_GROUP,
  MOCK_WHATSAPP_NEXT_CODE,
  MockWhatsAppClient,
} from '@/infrastructure/clients/WhatsAppClient/WhatsAppClient.mock';

/** Pairing and events are handled asynchronously; let them land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('WhatsApp connector end to end', () => {
  const whatsApp = new MockWhatsAppClient();
  let container: Container;
  let connectionId: string;

  const open = () => container.inboxService.list({ state: ItemState.Open, connectionId });

  beforeAll(() => {
    container = createTestContainer({ whatsAppClient: whatsApp });
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('is linked by a code that WhatsApp replaces while waiting, or by phone number', async () => {
    const kind = container.connectionService
      .describeConnectors()
      .find((descriptor) => descriptor.kind === ConnectorKind.WhatsApp);

    expect(kind?.pairing).toBe(true);
    expect(kind?.pairingByPhone).toBe(true);

    const start = await container.connectionService.beginPairing({ kind: ConnectorKind.WhatsApp });

    expect(start.code).toBe(MOCK_WHATSAPP_CODE);
    expect(
      await container.connectionService.pairingPhoneCode(start.pairingId, '+420 600 000 001')
    ).toBe('ABCD-EFGH');
    expect(whatsApp.phoneCodes).toEqual(['420600000001']);
    await expect(
      container.connectionService.pairingPhoneCode(start.pairingId, 'call me')
    ).rejects.toThrow('country code');
    await settle();

    const status = container.connectionService.pairingStatus(start.pairingId);

    expect(status.state).toBe(PairingState.Linked);
    expect(status.code).toBeNull();
    expect(status.connection?.name).toBe('WhatsApp');
    connectionId = status.connection?.id ?? '';

    const linked = await container.connectionService.get(connectionId);

    expect(linked?.status).toBe(ConnectionStatus.Running);
    expect(linked?.lastSyncAt).toBeInstanceOf(Date);
    expect(whatsApp.running?.auth).toBe('auth-1');
  });

  test('while waiting, the status carries the code to show now', async () => {
    const container2 = createTestContainer({
      whatsAppClient: Object.assign(new MockWhatsAppClient(), {
        // A phone that never scans.
        finishLink: () => new Promise(() => undefined),
      }),
    });
    const start = await container2.connectionService.beginPairing({
      kind: ConnectorKind.WhatsApp,
    });

    expect(container2.connectionService.pairingStatus(start.pairingId)).toMatchObject({
      state: PairingState.Waiting,
      code: MOCK_WHATSAPP_NEXT_CODE,
    });
    container2.close();
  });

  test('a direct message comes in as Important; reply, react and Done act on it', async () => {
    whatsApp.deliver({ type: WhatsAppEventType.Message, message: MOCK_WHATSAPP_DM });
    await settle();

    const [item] = await open();

    expect(item?.kind).toBe(ItemKind.DirectMessage);
    expect(item?.title).toBe('Petra in a direct message');
    expect(item?.category).toBe(Category.Important);
    expect(item?.url).toBe('https://wa.me/420600000002');
    expect(item?.appUrl).toBe('whatsapp://send?phone=420600000002');

    await container.inboxService.react(item?.id ?? '', 'thumbsup');
    expect(whatsApp.reactions).toEqual([{ id: MOCK_WHATSAPP_DM.id, emoji: '👍' }]);

    const replied = await container.inboxService.reply(item?.id ?? '', 'Yes, 6 pm.');

    expect(replied.state).toBe(ItemState.Done);
    expect(whatsApp.sent.at(-1)).toEqual({
      to: MOCK_WHATSAPP_DM.chat,
      text: 'Yes, 6 pm.',
      quote: MOCK_WHATSAPP_DM.id,
    });

    whatsApp.deliver({
      type: WhatsAppEventType.Message,
      message: { ...MOCK_WHATSAPP_DM, id: 'SECOND', text: 'And bring the map' },
    });
    await settle();

    const [second] = await open();

    await container.inboxService.done(second?.id ?? '');
    // Done sends read receipts, as reading on the phone would.
    expect(whatsApp.reads).toEqual(['SECOND']);
  });

  test('group chatter waits Undecided; a mention or an answer to me is Important', async () => {
    whatsApp.deliver({ type: WhatsAppEventType.Message, message: MOCK_WHATSAPP_GROUP });
    whatsApp.deliver({
      type: WhatsAppEventType.Message,
      message: {
        ...MOCK_WHATSAPP_GROUP,
        id: 'MENTION',
        text: '@Jozef can you drive?',
        mentionsMe: true,
      },
    });
    whatsApp.deliver({
      type: WhatsAppEventType.Message,
      message: { ...MOCK_WHATSAPP_GROUP, id: 'ANSWER', text: 'Yes, that works', repliesToMe: true },
    });
    await settle();

    const items = await open();
    const byId = (id: string) => items.find((item) => item.externalId === id);

    expect(items).toHaveLength(3);
    expect(byId(MOCK_WHATSAPP_GROUP.id)?.category).toBe(Category.Undecided);
    expect(byId(MOCK_WHATSAPP_GROUP.id)?.title).toBe('Tomáš in Family');
    expect(byId(MOCK_WHATSAPP_GROUP.id)?.url).toBeNull();
    expect(byId('MENTION')?.kind).toBe(ItemKind.Mention);
    expect(byId('MENTION')?.category).toBe(Category.Important);
    expect(byId('ANSWER')?.category).toBe(Category.Important);
  });

  test('reading on the phone or answering there clears it here', async () => {
    whatsApp.deliver({ type: WhatsAppEventType.Read, ids: ['MENTION'] });
    await settle();
    expect((await open()).map((item) => item.externalId).sort()).toEqual(
      [MOCK_WHATSAPP_GROUP.id, 'ANSWER'].sort()
    );

    whatsApp.deliver({ type: WhatsAppEventType.Sent, chat: MOCK_WHATSAPP_GROUP.chat });
    await settle();
    expect(await open()).toHaveLength(0);
  });

  test('new keys are stored, so a restart comes back as the same device', async () => {
    whatsApp.deliver({ type: WhatsAppEventType.Auth, auth: 'auth-2' });
    await settle();
    await container.connectorHost.restart(connectionId);

    expect(whatsApp.running?.auth).toBe('auth-2');
  });

  test('unlinked on the phone, it asks to link again; old keys never come back', async () => {
    whatsApp.deliver({ type: WhatsAppEventType.LoggedOut });
    whatsApp.deliver({ type: WhatsAppEventType.Auth, auth: 'stale' });
    await settle();

    expect((await container.connectionService.get(connectionId))?.status).toBe(
      ConnectionStatus.NeedsAuth
    );

    const again = await container.connectionService.beginPairing({ connectionId });

    await settle();
    expect(container.connectionService.pairingStatus(again.pairingId)).toMatchObject({
      state: PairingState.Linked,
      created: false,
    });
    expect(whatsApp.running?.auth).toBe('auth-1');
    // The same account linked again: the same connection, not a second one.
    expect((await container.connectionService.list()).map((c) => c.kind)).toEqual([
      ConnectorKind.WhatsApp,
    ]);
  });
});
