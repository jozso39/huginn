import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ActionType } from '@/core/actions/Action.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { ItemKind, ItemState } from '@/core/items/Item.types';
import { OAuthProvider, RedirectMode } from '@/core/oauth/OAuthApp.types';
import { SignInState } from '@/core/services/ConnectionService/ConnectionService.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_GMAIL_MESSAGE,
  MockGmailClient,
} from '@/infrastructure/clients/GmailClient/GmailClient.mock';
import {
  MOCK_GOOGLE_ACCOUNT,
  MOCK_REFRESH_TOKEN,
} from '@/infrastructure/clients/GoogleOAuthClient/GoogleOAuthClient.mock';

const GOOGLE_APP = {
  clientId: 'id-123.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-test',
  redirectMode: RedirectMode.Relay,
};

/** What Google (via the relay page) sends the browser back to after sign-in. */
const callbackFor = (url: string, code = 'good-code') => {
  const state = new URL(url).searchParams.get('state') ?? '';

  return `https://huginn.test.ts.net/api/oauth/callback?state=${state}&code=${code}`;
};

describe('Google sign-in and the Gmail connector', () => {
  const gmail = new MockGmailClient();
  let container: Container;
  let connectionId: string;

  const open = () => container.inboxService.list({ state: ItemState.Open, connectionId });

  /** Runs one poll by restarting the connector: start() catches up from the cursor. */
  const poll = () => container.connectorHost.restart(connectionId);

  beforeAll(() => {
    container = createTestContainer({ gmailClient: gmail });
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('sign-in needs the Google app set up first', async () => {
    await expect(
      container.connectionService.beginSignIn({ kind: ConnectorKind.Gmail })
    ).rejects.toMatchObject({ code: ErrorCode.Validation });

    const view = await container.oauthAppService.view(OAuthProvider.Google);

    expect(view.configured).toBe(false);
    expect(view.redirectUris).toEqual({
      Direct: 'https://huginn.test.ts.net/api/oauth/callback',
      Relay: 'https://relay.example.com/oauth/huginn/',
    });
  });

  test('the app is saved once, its secret sealed and never shown', async () => {
    const view = await container.oauthAppService.save(OAuthProvider.Google, GOOGLE_APP);

    expect(view).toMatchObject({ configured: true, clientId: GOOGLE_APP.clientId });
    expect(JSON.stringify(view)).not.toContain('GOCSPX');

    // An empty secret on a later save keeps the stored one.
    await container.oauthAppService.save(OAuthProvider.Google, { ...GOOGLE_APP, clientSecret: '' });
    expect((await container.oauthAppService.credentials(OAuthProvider.Google))?.clientSecret).toBe(
      'GOCSPX-test'
    );
  });

  test('signing in creates the connection, named after the account, and syncs', async () => {
    const { url, signInId } = await container.connectionService.beginSignIn({
      kind: ConnectorKind.Gmail,
    });
    const state = new URL(url).searchParams.get('state') ?? '';

    // The window that started it waits on this while the browser signs in.
    expect(container.connectionService.signInStatus(signInId).state).toBe(SignInState.Waiting);

    // Google is told to return to the relay; the state carries where Huginn lives.
    expect(url).toContain(encodeURIComponent('https://relay.example.com/oauth/huginn/'));
    expect(Buffer.from(state.split('.')[1] ?? '', 'base64url').toString()).toBe(
      'https://huginn.test.ts.net'
    );

    const connection = await container.connectionService.completeSignIn(callbackFor(url));
    const secrets = JSON.parse(
      await container.secretBox.open(
        (await container.connectionStore.getSecretsCiphertext(connection.id)) ?? ''
      )
    );

    connectionId = connection.id;
    expect(container.connectionService.signInStatus(signInId)).toMatchObject({
      state: SignInState.Done,
      connection: { id: connection.id },
      created: true,
    });
    expect(connection.name).toBe(MOCK_GOOGLE_ACCOUNT);
    expect(connection.status).toBe(ConnectionStatus.Running);
    expect(secrets).toEqual({ refreshToken: MOCK_REFRESH_TOKEN, account: MOCK_GOOGLE_ACCOUNT });

    const [item] = await open();

    expect(item?.kind).toBe(ItemKind.Email);
    expect(item?.body).toBe('Can you send the numbers by Friday?');
  });

  test('signing in again with the same account reuses its connection', async () => {
    const { url, signInId } = await container.connectionService.beginSignIn({
      kind: ConnectorKind.Gmail,
    });
    const again = await container.connectionService.completeSignIn(callbackFor(url));

    expect(again.id).toBe(connectionId);
    expect(container.connectionService.signInStatus(signInId)).toMatchObject({
      state: SignInState.Done,
      created: false,
    });
    expect(
      (await container.connectionService.list()).filter((c) => c.kind === ConnectorKind.Gmail)
    ).toHaveLength(1);
  });

  test('a state is single-use, and a refusal at Google is reported', async () => {
    const { url } = await container.connectionService.beginSignIn({ connectionId });

    await container.connectionService.completeSignIn(callbackFor(url));
    await expect(
      container.connectionService.completeSignIn(callbackFor(url))
    ).rejects.toMatchObject({ code: ErrorCode.Validation });

    const refused = await container.connectionService.beginSignIn({ connectionId });
    const state = new URL(refused.url).searchParams.get('state') ?? '';

    await expect(
      container.connectionService.completeSignIn(
        `https://huginn.test.ts.net/api/oauth/callback?state=${state}&error=access_denied`
      )
    ).rejects.toMatchObject({ code: ErrorCode.Unauthorized });
    // The window hears why, too, instead of waiting forever.
    expect(container.connectionService.signInStatus(refused.signInId)).toMatchObject({
      state: SignInState.Failed,
      error: 'Sign-in was refused: access_denied',
    });
    expect(() => container.connectionService.signInStatus('unknown')).toThrow(HuginnError);
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
    await revoked.oauthAppService.save(OAuthProvider.Google, GOOGLE_APP);

    const { url } = await revoked.connectionService.beginSignIn({ kind: ConnectorKind.Gmail });
    const after = await revoked.connectionService.completeSignIn(callbackFor(url));

    expect(after.status).toBe(ConnectionStatus.NeedsAuth);
    expect(after.statusMessage).toContain('sign in again');

    await revoked.connectorHost.stopAll();
    revoked.close();
  });
});

describe('Google sign-in in the Mac app (no relay page)', () => {
  test('signs in straight back to this Mac and lists the address of every port', async () => {
    const mac = createTestContainer({
      gmailClient: new MockGmailClient(),
      publicUrl: 'http://127.0.0.1:47823',
      relayUrl: null,
    });
    const view = await mac.oauthAppService.view(OAuthProvider.Google);

    expect(view.redirectMode).toBe(RedirectMode.Direct);
    expect(view.redirectUris).toEqual({
      Direct: 'http://127.0.0.1:47823/api/oauth/callback',
      Relay: null,
    });
    expect(view.registerUris).toEqual(
      mac.config.ports.map((port) => `http://127.0.0.1:${port}/api/oauth/callback`)
    );
    await expect(mac.oauthAppService.save(OAuthProvider.Google, GOOGLE_APP)).rejects.toMatchObject({
      code: ErrorCode.Validation,
    });

    await mac.oauthAppService.save(OAuthProvider.Google, {
      ...GOOGLE_APP,
      redirectMode: RedirectMode.Direct,
    });

    expect((await mac.oauthAppService.credentials(OAuthProvider.Google))?.redirectUri).toBe(
      'http://127.0.0.1:47823/api/oauth/callback'
    );
    mac.close();
  });
});
