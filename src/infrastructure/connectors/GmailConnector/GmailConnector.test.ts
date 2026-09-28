import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ActionType } from '@/core/actions/Action.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { AuthorizationMode } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { ItemKind, ItemState } from '@/core/items/Item.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_GMAIL_MESSAGE,
  MockGmailClient,
} from '@/infrastructure/clients/GmailClient/GmailClient.mock';
import { MOCK_REFRESH_TOKEN } from '@/infrastructure/clients/GoogleOAuthClient/GoogleOAuthClient.mock';

describe('Gmail connector end to end', () => {
  const gmail = new MockGmailClient();
  let container: Container;
  let connectionId: string;

  const open = () => container.inboxService.list({ state: ItemState.Open, connectionId });

  /** Runs one poll by restarting the connector: start() catches up from the cursor. */
  const poll = () => container.connectorHost.restart(connectionId);

  beforeAll(async () => {
    container = createTestContainer({ gmailClient: gmail });

    const connection = await container.connectionService.create({
      kind: ConnectorKind.Gmail,
      name: 'Personal Gmail',
      config: {},
      secrets: { clientId: 'id.apps.googleusercontent.com', clientSecret: 'secret' },
    });

    connectionId = connection.id;
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('a new connection waits for sign-in instead of failing', async () => {
    const connection = await container.connectionService.get(connectionId);

    expect(connection?.status).toBe(ConnectionStatus.NeedsAuth);
    expect(container.connectorHost.getConnector(connectionId)).toBeNull();
  });

  test('a stale or foreign address is refused', async () => {
    await expect(
      container.connectionService.completeSignIn('http://localhost/?state=nope&code=good-code')
    ).rejects.toMatchObject({ code: ErrorCode.Validation });
  });

  test('pasting the localhost address back signs in and runs the first sync', async () => {
    const start = await container.connectionService.beginSignIn(connectionId);
    const state = new URL(start.url).searchParams.get('state');

    expect(start.mode).toBe(AuthorizationMode.PasteBack);
    expect(start.url).toContain(encodeURIComponent('http://localhost'));

    const signedIn = await container.connectionService.completeSignIn(
      `http://localhost/?state=${state}&code=good-code&scope=gmail.modify`
    );
    const ciphertext = await container.connectionStore.getSecretsCiphertext(connectionId);
    const secrets = JSON.parse(await container.secretBox.open(ciphertext ?? ''));

    expect(signedIn.status).toBe(ConnectionStatus.Running);
    expect(secrets.refreshToken).toBe(MOCK_REFRESH_TOKEN);
    expect(secrets.clientSecret).toBe('secret');

    const [item] = await open();

    expect(item?.kind).toBe(ItemKind.Email);
    expect(item?.body).toBe('Can you send the numbers by Friday?');
  });

  test('the same state cannot be used twice', async () => {
    const start = await container.connectionService.beginSignIn(connectionId);
    const state = new URL(start.url).searchParams.get('state');
    const pasted = `http://localhost/?state=${state}&code=good-code`;

    await container.connectionService.completeSignIn(pasted);
    await expect(container.connectionService.completeSignIn(pasted)).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });
  });

  test('draft keeps the item open; reply sends in-thread and closes it', async () => {
    const [item] = await open();
    const drafted = await container.inboxService.draft(item?.id ?? '', 'Draft text');

    expect(drafted.state).toBe(ItemState.Open);
    expect(gmail.drafts[0]?.threadId).toBe('t1');

    const replied = await container.inboxService.reply(item?.id ?? '', 'Pošlu v pátek.');
    const detail = await container.inboxService.get(replied.id);

    expect(replied.state).toBe(ItemState.Done);
    expect(gmail.sent[0]?.threadId).toBe('t1');
    expect(detail?.actions.map((action) => action.type)).toEqual([
      ActionType.Draft,
      ActionType.Reply,
    ]);
  });

  test('Done marks the mail read in Gmail', async () => {
    const [item] = await container.inboxService.list({ state: ItemState.Done, connectionId });

    await container.inboxService.reopen(item?.id ?? '');
    await container.inboxService.done(item?.id ?? '');

    expect(gmail.markedRead).toEqual(['m1']);
  });

  test('history: new mail comes in, mail read in Gmail leaves, my reply closes its thread', async () => {
    gmail.messages.set('m2', { ...MOCK_GMAIL_MESSAGE, id: 'm2', threadId: 't2' });
    gmail.messages.set('m3', { ...MOCK_GMAIL_MESSAGE, id: 'm3', threadId: 't3' });
    gmail.messages.set('m4', {
      ...MOCK_GMAIL_MESSAGE,
      id: 'm4',
      threadId: 't4',
      labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
    });
    gmail.nextHistory = {
      historyId: '200',
      records: [
        {
          messagesAdded: [{ message: { id: 'm2', threadId: 't2', labelIds: ['INBOX', 'UNREAD'] } }],
        },
        {
          messagesAdded: [{ message: { id: 'm3', threadId: 't3', labelIds: ['INBOX', 'UNREAD'] } }],
        },
        { messagesAdded: [{ message: { id: 'm4', threadId: 't4', labelIds: ['INBOX'] } }] },
      ],
    };
    await poll();

    // Promotions stay out under the default scope.
    expect((await open()).map((item) => item.externalId).sort()).toEqual(['m2', 'm3']);

    gmail.nextHistory = {
      historyId: '201',
      records: [
        { labelsRemoved: [{ message: { id: 'm2', threadId: 't2' }, labelIds: ['UNREAD'] }] },
        { messagesAdded: [{ message: { id: 's9', threadId: 't3', labelIds: ['SENT'] } }] },
      ],
    };
    await poll();

    expect(await open()).toHaveLength(0);
  });

  test('a revoked grant asks for sign-in instead of retrying forever', async () => {
    const failing = new MockGmailClient();
    const revoked = createTestContainer({ gmailClient: failing });

    failing.profile = () =>
      Promise.reject(new HuginnError(ErrorCode.Unauthorized, 'Google sign-in: invalid_grant'));

    const connection = await revoked.connectionService.create({
      kind: ConnectorKind.Gmail,
      name: 'Revoked',
      config: {},
      secrets: { clientId: 'id', clientSecret: 's' },
    });
    const start = await revoked.connectionService.beginSignIn(connection.id);
    const state = new URL(start.url).searchParams.get('state');
    const after = await revoked.connectionService.completeSignIn(
      `http://localhost/?state=${state}&code=good-code`
    );

    expect(after.status).toBe(ConnectionStatus.NeedsAuth);
    expect(after.statusMessage).toContain('sign in again');

    await revoked.connectorHost.stopAll();
    revoked.close();
  });
});
