import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ActionType } from '@/core/actions/Action.types';
import { ConnectionStatus, ConnectorKind } from '@/core/connections/Connection.types';
import { ItemKind, ItemState } from '@/core/items/Item.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import {
  MOCK_CLICKUP_BOSS,
  MOCK_CLICKUP_COMMENT,
  MOCK_CLICKUP_ME,
  MOCK_CLICKUP_TASK,
  MockClickUpClient,
} from '@/infrastructure/clients/ClickUpClient/ClickUpClient.mock';

const now = () => String(Date.now());

describe('ClickUp connector end to end', () => {
  const clickUp = new MockClickUpClient();
  let container: Container;
  let connectionId: string;

  const open = () => container.inboxService.list({ state: ItemState.Open, connectionId });
  const poll = () => container.connectorHost.restart(connectionId);

  beforeAll(async () => {
    // task1 was already assigned before Huginn: backlog, not a new assignment.
    clickUp.openTaskIds = ['task1'];
    container = createTestContainer({ clickUpClient: clickUp });

    const connection = await container.connectionService.create({
      kind: ConnectorKind.ClickUp,
      name: 'Medevio ClickUp',
      config: {},
      secrets: { token: 'pk_test' },
    });

    connectionId = connection.id;
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('first sync: recent comments come in, the existing backlog does not', async () => {
    const items = await open();

    expect((await container.connectionService.get(connectionId))?.status).toBe(
      ConnectionStatus.Running
    );
    expect(items.map((item) => item.kind)).toEqual([ItemKind.Mention]);
    expect(items[0]?.body).toBe('Hey @Jozef Čambora can you do this today?');
  });

  test('a reply goes into the comment thread and archives the item', async () => {
    const [item] = await open();
    const replied = await container.inboxService.reply(item?.id ?? '', 'Doing it now.');
    const detail = await container.inboxService.get(replied.id);

    expect(replied.state).toBe(ItemState.Done);
    expect(clickUp.posted).toEqual([{ commentId: 'c1', text: 'Doing it now.' }]);
    expect(detail?.actions[0]?.type).toBe(ActionType.Reply);
  });

  test('a task newly assigned to me comes in once', async () => {
    clickUp.tasks = [
      ...clickUp.tasks,
      {
        ...MOCK_CLICKUP_TASK,
        id: 'task2',
        name: 'Rotate the staging DB password',
        url: 'https://app.clickup.com/t/task2',
        date_updated: now(),
      },
    ];
    clickUp.comments.set('task2', []);
    await poll();

    const assignments = (await open()).filter((item) => item.kind === ItemKind.Assignment);

    expect(assignments.map((item) => item.title)).toEqual(['Rotate the staging DB password']);

    // Updated again later: still one item, it is known now.
    clickUp.tasks = clickUp.tasks.map((task) =>
      task.id === 'task2' ? { ...task, date_updated: String(Date.now() + 1000) } : task
    );
    await poll();
    expect((await open()).filter((item) => item.kind === ItemKind.Assignment)).toHaveLength(1);
  });

  test('commenting in ClickUp myself closes that task here', async () => {
    const later = String(Date.now() + 5000);

    clickUp.comments.set('task2', [
      {
        ...MOCK_CLICKUP_COMMENT,
        id: 'c9',
        user: MOCK_CLICKUP_ME,
        comment_text: 'On it',
        date: later,
      },
    ]);
    clickUp.tasks = clickUp.tasks.map((task) =>
      task.id === 'task2' ? { ...task, date_updated: later } : task
    );
    await poll();

    expect(await open()).toHaveLength(0);
  });

  test('with the rate limit nearly used, it skips a poll and says so', async () => {
    clickUp.remaining = 3;
    clickUp.tasks = [
      { ...MOCK_CLICKUP_TASK, id: 'task3', date_updated: String(Date.now() + 9000) },
    ];
    clickUp.comments.set('task3', [
      {
        ...MOCK_CLICKUP_COMMENT,
        id: 'c10',
        user: MOCK_CLICKUP_BOSS,
        date: String(Date.now() + 9000),
      },
    ]);
    await poll();

    const connection = await container.connectionService.get(connectionId);

    expect(connection?.statusMessage).toContain('rate limit');
    expect(await open()).toHaveLength(0);

    clickUp.remaining = 90;
    await poll();
    expect((await open()).map((item) => item.externalId)).toContain('comment:c10');
  });
});
