import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { MessengerMessage } from '@/core/clients/MessengerClient/MessengerClient.types';
import { MessengerEventType } from '@/core/clients/MessengerClient/MessengerClient.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { Category, ItemKind, ItemState } from '@/core/items/Item.types';
import { MockLoginWindow } from '@/core/login/LoginWindow.mock';
import { PairingState } from '@/core/services/ConnectionService/ConnectionService.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_MESSENGER_ACCOUNT,
  MockMessengerClient,
} from '@/infrastructure/clients/MessengerClient/MessengerClient.mock';

/** Pairing and events are handled asynchronously; let them land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const COOKIES = { xs: 'xs-1', c_user: MOCK_MESSENGER_ACCOUNT.userId, datr: 'datr-1' };

const DM: MessengerMessage = {
  id: 'mid.1',
  threadId: '100000002',
  encrypted: true,
  isGroup: false,
  threadName: null,
  senderId: '100000002',
  senderName: 'Petra',
  fromMe: false,
  text: 'Are we still on for tonight?',
  sentAt: new Date('2026-10-21T17:00:00Z'),
  replyToId: null,
  url: 'https://www.facebook.com/messages/e2ee/t/100000002',
  initial: false,
};

const GROUP: MessengerMessage = {
  ...DM,
  id: 'mid.2',
  threadId: '200000001',
  encrypted: false,
  isGroup: true,
  threadName: 'Climbing',
  senderName: 'Tomáš',
  text: '[photo]',
  url: 'https://www.facebook.com/messages/t/200000001',
};

describe('Messenger connector end to end', () => {
  const messenger = new MockMessengerClient();
  const loginWindow = new MockLoginWindow();
  let container: Container;
  let connectionId: string;

  const open = () => container.inboxService.list({ state: ItemState.Open, connectionId });
  const session = () => messenger.sessions.at(-1);

  beforeAll(() => {
    container = createTestContainer({ messengerClient: messenger, loginWindow });
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('is added by logging in on Facebook’s page in the login window, never by a QR code', async () => {
    const kind = container.connectionService
      .describeConnectors()
      .find((descriptor) => descriptor.kind === ConnectorKind.Messenger);

    expect(kind).toMatchObject({ pairing: true, pairingInWindow: true, unavailable: null });

    const start = await container.connectionService.beginPairing({
      kind: ConnectorKind.Messenger,
    });
    const [request] = loginWindow.requests;

    // The window poses as the browser the helper uses, and takes only the session cookies.
    expect(request?.userAgent).toBe(await messenger.userAgent());
    expect(request?.url).toBe('https://www.facebook.com/login/');
    expect(request?.required).toEqual(['xs', 'c_user', 'datr']);
    expect(new RegExp(request?.done ?? '').test(request?.url ?? '')).toBe(false);
    expect(new RegExp(request?.done ?? '').test('https://www.facebook.com/')).toBe(true);
    expect(new RegExp(request?.done ?? '').test('https://www.facebook.com/checkpoint/')).toBe(
      false
    );
    expect(container.connectionService.pairingStatus(start.pairingId).state).toBe(
      PairingState.Waiting
    );

    loginWindow.logIn(COOKIES);
    await settle();

    const status = container.connectionService.pairingStatus(start.pairingId);

    expect(status.state).toBe(PairingState.Linked);
    expect(status.connection?.name).toBe('Messenger');
    expect(messenger.logins).toEqual([COOKIES]);
    connectionId = status.connection?.id ?? '';

    const linked = await container.connectionService.get(connectionId);

    expect(linked?.status).toBe(ConnectionStatus.Running);
    expect(session()?.cookies).toEqual(COOKIES);
  });

  test('closing the window before logging in fails the attempt', async () => {
    const start = await container.connectionService.beginPairing({
      kind: ConnectorKind.Messenger,
    });

    loginWindow.close();
    await settle();

    expect(container.connectionService.pairingStatus(start.pairingId)).toMatchObject({
      state: PairingState.Failed,
      error: 'The login window was closed before you logged in',
    });
  });

  test('a direct message comes in as Important, a group message as a message', async () => {
    session()?.emit({ type: MessengerEventType.Message, message: DM });
    session()?.emit({ type: MessengerEventType.Message, message: GROUP });
    await settle();

    const items = await open();
    const dm = items.find((item) => item.externalId === DM.id);
    const group = items.find((item) => item.externalId === GROUP.id);

    expect(dm).toMatchObject({
      kind: ItemKind.DirectMessage,
      title: 'Petra in a direct message',
      category: Category.Important,
      url: DM.url,
      body: DM.text,
    });
    expect(group).toMatchObject({ kind: ItemKind.Message, title: 'Tomáš in Climbing' });
    expect(group?.features.isEncrypted).toBe(false);
  });

  test('writing or reading the chat elsewhere closes it here', async () => {
    session()?.emit({
      type: MessengerEventType.Message,
      message: { ...DM, id: 'mid.3', fromMe: true, text: 'Yes!' },
    });
    session()?.emit({
      type: MessengerEventType.Read,
      threadId: GROUP.threadId,
      readAt: new Date('2026-10-21T17:05:00Z'),
    });
    await settle();

    expect(await open()).toEqual([]);
  });

  test('refreshed cookies are stored for the next start; a logout asks to log in again', async () => {
    const fresh = { ...COOKIES, xs: 'xs-2' };

    session()?.emit({ type: MessengerEventType.Cookies, cookies: fresh });
    await settle();
    await container.connectorHost.restart(connectionId);
    expect(session()?.cookies).toEqual(fresh);

    session()?.emit({ type: MessengerEventType.LoggedOut, reason: 'session expired' });
    await settle();

    const connection = await container.connectionService.get(connectionId);

    expect(connection?.status).toBe(ConnectionStatus.NeedsAuth);
    expect(connection?.statusMessage).toBe('Facebook ended the session — log in again');
  });

  test('a session Facebook already ended asks to log in again instead of failing', async () => {
    messenger.unauthorized = true;
    await container.connectorHost.restart(connectionId);
    messenger.unauthorized = false;

    expect((await container.connectionService.get(connectionId))?.status).toBe(
      ConnectionStatus.NeedsAuth
    );
  });

  test('cannot be added outside the Mac app or without the helper', () => {
    const withoutApp = createTestContainer({
      loginWindow: null,
      messengerClient: new MockMessengerClient(),
    });
    const withoutHelper = createTestContainer({
      loginWindow,
      messengerClient: Object.assign(new MockMessengerClient(), { available: false }),
    });
    const reason = (c: Container) =>
      c.connectionService.describeConnectors().find((d) => d.kind === ConnectorKind.Messenger)
        ?.unavailable;

    expect(reason(withoutApp)).toContain('Mac app');
    expect(reason(withoutHelper)).toContain('helper is missing');
    withoutApp.close();
    withoutHelper.close();
  });
});
