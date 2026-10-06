import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ActionType } from '@/core/actions/Action.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { ItemKind, ItemState } from '@/core/items/Item.types';
import { OAuthProvider, RedirectMode } from '@/core/oauth/OAuthApp.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_SLACK_DM,
  MOCK_SLACK_ME,
  MockSlackClient,
} from '@/infrastructure/clients/SlackClient/SlackClient.mock';
import {
  MOCK_SLACK_CODE,
  MockSlackOAuthClient,
} from '@/infrastructure/clients/SlackOAuthClient/SlackOAuthClient.mock';

const SLACK_APP = {
  clientId: '1234567890.0987654321',
  clientSecret: '',
  redirectMode: RedirectMode.Direct,
};

const challengeOf = async (verifier: string) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString(
    'base64url'
  );

describe('Slack connector end to end', () => {
  const slack = new MockSlackClient();
  const oauth = new MockSlackOAuthClient();
  let container: Container;
  let connectionId: string;
  let authorizeUrl: URL;

  const poll = () => container.connectorHost.restart(connectionId);
  const open = () => container.inboxService.list({ state: ItemState.Open, connectionId });

  beforeAll(async () => {
    container = createTestContainer({
      slackClient: slack,
      slackOAuthClient: oauth,
      publicUrl: 'http://127.0.0.1:47823',
    });
    await container.oauthAppService.save(OAuthProvider.Slack, SLACK_APP);

    const { url } = await container.connectionService.beginSignIn({ kind: ConnectorKind.Slack });

    authorizeUrl = new URL(url);

    const state = authorizeUrl.searchParams.get('state') ?? '';
    const connection = await container.connectionService.completeSignIn(
      `http://localhost:47823/api/oauth/callback?state=${state}&code=${MOCK_SLACK_CODE}`
    );

    connectionId = connection.id;
    // Watching #releases restarts it, which is a check.
    await container.connectionService.update(connectionId, {
      name: connection.name,
      config: { watchChannels: '#releases' },
    });
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('signing in asks Slack with PKCE and user scopes only, back to localhost', async () => {
    const params = authorizeUrl.searchParams;
    const [exchange] = oauth.exchanged;

    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      'https://slack.com/oauth/v2/authorize'
    );
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('user_scope')).toContain('search:read');
    expect(params.has('scope')).toBe(false);
    expect(params.get('redirect_uri')).toBe('http://localhost:47823/api/oauth/callback');
    // The verifier redeemed is the one behind the challenge sent out.
    expect(params.get('code_challenge')).toBe(await challengeOf(exchange?.codeVerifier ?? ''));

    const connection = await container.connectionService.get(connectionId);

    expect(connection?.name).toBe('Acme Slack');
    expect(connection?.status).toBe(ConnectionStatus.Running);
  });

  test('the slack app needs no secret: its client ID is all a colleague is given', async () => {
    const view = await container.oauthAppService.view(OAuthProvider.Slack);

    expect(view.needsSecret).toBe(false);
    // Signing in comes back to this Huginn's own port; every port it may use is registered.
    expect(view.redirectUris.Direct).toBe('http://localhost:47823/api/oauth/callback');
    expect(view.registerUris).toEqual(
      container.config.ports.map((port) => `http://localhost:${port}/api/oauth/callback`)
    );
  });

  test("the boss's DM arrives as a readable direct message with a deep link", async () => {
    const [item] = await open();

    expect(item?.kind).toBe(ItemKind.DirectMessage);
    expect(item?.author).toBe('The Boss');
    expect(item?.body).toBe('Hi @jozef, can you clean up the old worktrees in ai-service?');
    expect(item?.url).toBe('https://acme.slack.com/archives/DBOSS/p1759046400000100');
    expect(item?.features.isPersonalMention).toBe(true);
  });

  test('replying from Huginn answers in a thread and archives the item', async () => {
    const [item] = await open();
    const replied = await container.inboxService.reply(item?.id ?? '', 'Sure, today.');
    const detail = await container.inboxService.get(replied.id);

    expect(replied.state).toBe(ItemState.Done);
    expect(detail?.actions[0]?.type).toBe(ActionType.Reply);
    // Even in a DM the answer goes under the message it answers, as a thread reply.
    expect(slack.posted.at(-1)).toEqual({
      channel: MOCK_SLACK_DM.channel,
      text: 'Sure, today.',
      threadTs: MOCK_SLACK_DM.ts,
    });

    // The boss answers in that thread: the next check brings a new open item.
    slack.deliver({
      ...MOCK_SLACK_DM,
      text: 'Thanks!',
      ts: '1759046600.000300',
      thread_ts: MOCK_SLACK_DM.ts,
    });
    await poll();

    expect((await open()).map((i) => i.body)).toEqual(['Thanks!']);
  });

  test('answering in Slack itself clears the thread here', async () => {
    slack.deliver({
      ...MOCK_SLACK_DM,
      user: MOCK_SLACK_ME,
      text: '👍',
      ts: '1759046700.000400',
      thread_ts: MOCK_SLACK_DM.ts,
    });
    await poll();

    expect(await open()).toHaveLength(0);
  });

  test('channel chatter is ignored; mentions, my threads and watched channels are kept', async () => {
    const channel = { ...MOCK_SLACK_DM, channel: 'CGEN', channel_type: 'channel' as const };

    slack.deliver({ ...channel, text: 'lunch?', ts: '1759047000.000001' });
    slack.deliver({
      ...channel,
      text: '<!subteam^SBACKEND> deploy is red',
      ts: '1759047001.000001',
    });
    slack.deliver({
      ...channel,
      channel: 'CWATCH',
      text: 'release notes',
      ts: '1759047002.000001',
    });
    await poll();

    expect((await open()).map((item) => item.body).sort()).toEqual([
      '@backend deploy is red',
      'release notes',
    ]);
  });

  test('checking again finds nothing twice', async () => {
    const before = (await open()).length;

    await poll();

    expect(await open()).toHaveLength(before);
  });

  test('react goes to Slack and is archived without closing the item', async () => {
    const [item] = await open();
    const reacted = await container.inboxService.react(item?.id ?? '', 'eyes');
    const detail = await container.inboxService.get(reacted.id);

    expect(reacted.state).toBe(ItemState.Open);
    expect(detail?.actions.map((action) => action.type)).toEqual([ActionType.React]);
  });

  test('an emoji is sent to Slack by its short name; one Slack does not know is refused', async () => {
    const [item] = await open();

    await container.inboxService.react(item?.id ?? '', '🫥');
    await container.inboxService.react(item?.id ?? '', '👍🏽');

    expect(slack.reactions.slice(-2).map((reaction) => reaction.name)).toEqual([
      'dotted_line_face',
      '+1::skin-tone-4',
    ]);
    await expect(container.inboxService.react(item?.id ?? '', 'Hi!')).rejects.toThrow(
      'Slack has no name for Hi!'
    );
  });

  test('refreshed tokens are kept, sealed, for the next start', async () => {
    await slack.rotate({
      accessToken: 'xoxe.xoxp-rotated',
      refreshToken: 'xoxe-1-rotated',
      expiresAt: 1_900_000_000_000,
    });

    const sealed = await container.connectionStore.getSecretsCiphertext(connectionId);

    expect(sealed).not.toContain('rotated');
    expect(JSON.parse(await container.secretBox.open(sealed ?? ''))).toMatchObject({
      userToken: 'xoxe.xoxp-rotated',
      refreshToken: 'xoxe-1-rotated',
      expiresAt: '1900000000000',
    });
  });

  test('signing in again with the same person refreshes this connection', async () => {
    const { url } = await container.connectionService.beginSignIn({ kind: ConnectorKind.Slack });
    const state = new URL(url).searchParams.get('state') ?? '';
    const again = await container.connectionService.completeSignIn(
      `http://localhost:47823/api/oauth/callback?state=${state}&code=${MOCK_SLACK_CODE}`
    );

    expect(again.id).toBe(connectionId);
    expect(
      (await container.connectionService.list()).filter((c) => c.kind === ConnectorKind.Slack)
    ).toHaveLength(1);
  });

  test('a token Slack refuses (no search permission yet) asks to sign in again', async () => {
    slack.searchFails = new HuginnError(
      ErrorCode.Unauthorized,
      'Sign in with Slack again: Huginn needs a permission it does not have yet'
    );
    await poll();

    const connection = await container.connectionService.get(connectionId);

    expect(connection?.status).toBe(ConnectionStatus.NeedsAuth);
    expect(connection?.statusMessage).toContain('Sign in with Slack again');
    slack.searchFails = null;
  });
});

describe('A Slack connection from before sign-in (pasted tokens)', () => {
  test('is taken over by the first sign-in, keeping its items, rules and category', async () => {
    const container = createTestContainer({
      slackClient: new MockSlackClient(),
      slackOAuthClient: new MockSlackOAuthClient(),
      publicUrl: 'http://127.0.0.1:47823',
    });
    const legacy = await container.connectionStore.create({
      kind: ConnectorKind.Slack,
      name: 'Medevio Slack',
      config: {},
      secretsCiphertext: await container.secretBox.seal(
        JSON.stringify({ userToken: 'xoxp-old', appToken: 'xapp-old' })
      ),
      groupId: null,
      color: '#3b82f6',
    });

    await container.oauthAppService.save(OAuthProvider.Slack, SLACK_APP);

    const { url } = await container.connectionService.beginSignIn({ kind: ConnectorKind.Slack });
    const state = new URL(url).searchParams.get('state') ?? '';
    const signedIn = await container.connectionService.completeSignIn(
      `http://localhost:47823/api/oauth/callback?state=${state}&code=${MOCK_SLACK_CODE}`
    );

    expect(signedIn.id).toBe(legacy.id);
    expect(signedIn.name).toBe('Medevio Slack');
    await container.connectorHost.stopAll();
    container.close();
  });
});
