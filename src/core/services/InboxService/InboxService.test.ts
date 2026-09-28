import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ActionType } from '@/core/actions/Action.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
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

  test('ingest creates an item for a connection that has no poller', async () => {
    const ingest = await container.connectionService.create({
      kind: ConnectorKind.Ingest,
      name: 'Scripts',
      config: {},
      secrets: {},
    });
    const item = await container.inboxService.ingest({
      connectionId: ingest.id,
      externalId: 'backup-2026-09-28',
      threadKey: 'backups',
      kind: ItemKind.Alert,
      author: 'restic',
      title: 'Backup failed',
      body: 'snapshot stale',
      url: null,
      receivedAt: new Date(),
      features: { severity: 'high' },
      raw: {},
    });

    expect(item.state).toBe(ItemState.Open);
    await expect(container.inboxService.reply(item.id, 'hi')).rejects.toBeInstanceOf(HuginnError);
  });
});
