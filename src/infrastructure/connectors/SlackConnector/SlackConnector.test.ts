import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ActionType } from '@/core/actions/Action.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { ItemKind, ItemState } from '@/core/items/Item.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_SLACK_DM,
  MOCK_SLACK_ME,
  MockSlackClient,
} from '@/infrastructure/clients/SlackClient/SlackClient.mock';

/** Lets the connector's serial event queue drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Slack connector end to end', () => {
  const slack = new MockSlackClient();
  let container: Container;
  let connectionId: string;

  beforeAll(async () => {
    container = createTestContainer({ slackClient: slack });

    const connection = await container.connectionService.create({
      kind: ConnectorKind.Slack,
      name: 'Work Slack',
      config: { watchChannels: 'CWATCH' },
      secrets: { userToken: 'xoxp-test', appToken: 'xapp-test' },
    });

    connectionId = connection.id;
    await settle();
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test("the boss's DM arrives as a readable direct message with a deep link", async () => {
    const [item] = await container.inboxService.list({ state: ItemState.Open, connectionId });

    expect(item?.kind).toBe(ItemKind.DirectMessage);
    expect(item?.author).toBe('The Boss');
    expect(item?.body).toBe('Hi @jozef, can you clean up the old worktrees in ai-service?');
    expect(item?.url).toBe('https://acme.slack.com/archives/DBOSS/p1759046400000100');
    expect(item?.features.isPersonalMention).toBe(true);
  });

  test('replying from Huginn archives the item and follows the thread', async () => {
    const [item] = await container.inboxService.list({ state: ItemState.Open, connectionId });
    const replied = await container.inboxService.reply(item?.id ?? '', 'Sure, today.');
    const detail = await container.inboxService.get(replied.id);

    expect(replied.state).toBe(ItemState.Done);
    expect(detail?.actions[0]?.type).toBe(ActionType.Reply);

    // The boss answers in the same DM: a new open item in the same conversation.
    slack.deliver({ ...MOCK_SLACK_DM, text: 'Thanks!', ts: '1759046600.000300' });
    await settle();

    const open = await container.inboxService.list({ state: ItemState.Open, connectionId });

    expect(open).toHaveLength(1);
    expect(open[0]?.threadKey).toBe(replied.threadKey);
  });

  test('answering in Slack itself clears the conversation here', async () => {
    slack.deliver({ ...MOCK_SLACK_DM, user: MOCK_SLACK_ME, text: '👍', ts: '1759046700.000400' });
    await settle();

    expect(await container.inboxService.list({ state: ItemState.Open, connectionId })).toHaveLength(
      0
    );
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
    await settle();

    const open = await container.inboxService.list({ state: ItemState.Open, connectionId });

    expect(open.map((item) => item.body).sort()).toEqual([
      '@backend deploy is red',
      'release notes',
    ]);
  });

  test('react goes to Slack and is archived without closing the item', async () => {
    const [item] = await container.inboxService.list({ state: ItemState.Open, connectionId });
    const reacted = await container.inboxService.react(item?.id ?? '', 'eyes');
    const detail = await container.inboxService.get(reacted.id);

    expect(reacted.state).toBe(ItemState.Open);
    expect(detail?.actions.map((action) => action.type)).toEqual([ActionType.React]);
  });
});
