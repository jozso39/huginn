import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ActionType } from '@/core/actions/Action.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { MockConnectorFactory } from '@/core/connectors/Connector.mock';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { HuginnEvent } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import { ItemKind, ItemState } from '@/core/items/Item.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';

describe('InboxService with a GitLab connection', () => {
  let container: Container;
  let connectionId: string;
  const events: HuginnEvent[] = [];

  beforeAll(async () => {
    container = createTestContainer();
    container.eventBus.subscribe((event) => {
      events.push(event);
    });

    const connection = await container.connectionService.create({
      kind: ConnectorKind.GitLab,
      name: 'Test GitLab',
      config: { baseUrl: 'https://gitlab.example.com' },
      secrets: { token: 'glpat-test' },
    });

    connectionId = connection.id;
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('the first poll lands the mock todo as an open item and announces it', async () => {
    const items = await container.inboxService.list({ state: ItemState.Open });

    expect(items).toHaveLength(1);
    expect(items[0]?.connectionId).toBe(connectionId);
    expect(items[0]?.kind).toBe(ItemKind.ReviewRequest);
    expect(events.some((event) => event.type === HuginnEventType.ItemUpserted)).toBe(true);
  });

  test('reply goes to the provider, is archived, and closes the item', async () => {
    const [open] = await container.inboxService.list({ state: ItemState.Open });
    const replied = await container.inboxService.reply(open?.id ?? '', 'On it.');

    expect(replied.state).toBe(ItemState.Done);

    const detail = await container.inboxService.get(replied.id);

    expect(detail?.actions.map((action) => action.type)).toEqual([ActionType.Reply]);
    expect(detail?.actions[0]?.payload).toEqual({ text: 'On it.' });
    expect(detail?.actions[0]?.result?.ok).toBe(true);
  });

  test('react is refused where the connector cannot react', async () => {
    const [item] = await container.inboxService.list({ state: ItemState.Done });

    await expect(container.inboxService.react(item?.id ?? '', 'thumbsup')).rejects.toMatchObject({
      code: ErrorCode.Unsupported,
    });
  });

  test('reopen and done round-trip, with done recorded', async () => {
    const [item] = await container.inboxService.list({ state: ItemState.Done });
    const reopened = await container.inboxService.reopen(item?.id ?? '');

    expect(reopened.state).toBe(ItemState.Open);

    const done = await container.inboxService.done(reopened.id);
    const detail = await container.inboxService.get(done.id);

    expect(done.state).toBe(ItemState.Done);
    expect(detail?.actions.map((action) => action.type)).toEqual([
      ActionType.Reply,
      ActionType.Done,
    ]);
  });
});

describe('A source that cannot answer', () => {
  test('refuses a reply instead of pretending it was sent', async () => {
    const builds = new MockConnectorFactory(ConnectorKind.GitLab);
    const container = createTestContainer({ connectorFactories: [builds] });
    const connection = await container.connectionService.create({
      kind: ConnectorKind.GitLab,
      name: 'Builds',
      config: {},
      secrets: {},
    });
    const item = await builds.deliver({
      connectionId: connection.id,
      externalId: 'pipeline-41',
      threadKey: 'pipeline-41',
      kind: ItemKind.Alert,
      author: 'CI',
      title: 'Pipeline failed',
      body: 'main, job test',
      url: null,
      receivedAt: new Date(),
      features: {},
      raw: {},
    });

    expect(item.state).toBe(ItemState.Open);
    await expect(container.inboxService.reply(item.id, 'hi')).rejects.toBeInstanceOf(HuginnError);

    await container.connectorHost.stopAll();
    container.close();
  });
});

describe('Searching the archive', () => {
  const team = new MockConnectorFactory(ConnectorKind.Slack);
  let container: Container;

  beforeAll(async () => {
    container = createTestContainer({ connectorFactories: [team] });

    const channel = await container.connectionService.create({
      kind: ConnectorKind.Slack,
      name: 'Team',
      config: {},
      secrets: {},
    });
    const messages = [
      { id: 'a', author: 'Matúš Kašuba', title: 'Release notes', body: 'Ready for review' },
      { id: 'b', author: 'Igor', title: 'Deploy blocked', body: 'The pipeline failed at 100%' },
      { id: 'c', author: 'Igor', title: 'Lunch?', body: 'Pizza at noon' },
    ];
    const items = await Promise.all(
      messages.map((m, index) =>
        team.deliver({
          connectionId: channel.id,
          externalId: m.id,
          threadKey: m.id,
          kind: ItemKind.Message,
          author: m.author,
          title: m.title,
          body: m.body,
          url: null,
          receivedAt: new Date(Date.UTC(2026, 9, 1, index)),
          features: {},
          raw: {},
        })
      )
    );

    // a and b are archived; c stays in the inbox.
    await Promise.all(items.slice(0, 2).map((item) => container.inboxService.done(item.id)));
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  const search = async (query: string) =>
    (await container.inboxService.list({ state: ItemState.Done, query })).map((i) => i.title);

  test('finds by author, title or body, ignoring case and accents', async () => {
    expect(await search('kasuba')).toEqual(['Release notes']);
    expect(await search('PIPELINE')).toEqual(['Deploy blocked']);
    expect(await search('igor')).toEqual(['Deploy blocked']);
  });

  test('every word has to match, and SQL wildcards are just characters', async () => {
    expect(await search('igor failed')).toEqual(['Deploy blocked']);
    expect(await search('igor review')).toEqual([]);
    expect(await search('100%')).toEqual(['Deploy blocked']);
    expect(await search('_')).toEqual([]);
  });

  test('an empty query lists the whole archive, newest first', async () => {
    expect(await search('  ')).toEqual(['Deploy blocked', 'Release notes']);
  });
});
