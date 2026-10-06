import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MockAttentionSink } from '@/core/attention/AttentionSink.mock';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { MockConnectorFactory } from '@/core/connectors/Connector.mock';
import { Category, ItemKind } from '@/core/items/Item.types';
import { ConditionOp, RuleKind, RuleOrigin, RuleVerdict } from '@/core/triage/Rule.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';

/** The badge waits for a burst of changes to settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe('AttentionService (menu-bar count and notifications)', () => {
  const sink = new MockAttentionSink();
  const alerts = new MockConnectorFactory(ConnectorKind.GitLab);
  let container: Container;
  let connectionId: string;
  let counter = 0;

  const deliver = (title: string, receivedAt = new Date()) =>
    alerts.deliver({
      connectionId,
      externalId: `a${++counter}`,
      threadKey: `t${counter}`,
      kind: ItemKind.Alert,
      author: 'Monitoring',
      title,
      body: title,
      url: null,
      receivedAt,
      features: {},
      raw: {},
    });

  beforeAll(async () => {
    container = createTestContainer({ attentionSink: sink, connectorFactories: [alerts] });
    connectionId = (
      await container.connectionService.create({
        kind: ConnectorKind.GitLab,
        name: 'Alerts',
        config: {},
        secrets: {},
      })
    ).id;
    await container.ruleService.create(
      connectionId,
      {
        name: 'Outages',
        verdict: RuleVerdict.Important,
        kind: RuleKind.Hard,
        predicate: { field: 'title', op: ConditionOp.Contains, value: 'down' },
      },
      { origin: RuleOrigin.User }
    );
    await container.attentionService.start();
  });

  afterAll(async () => {
    container.attentionService.stop();
    await container.connectorHost.stopAll();
    container.close();
  });

  test('starts with the current count, then a new Important item is announced and counted', async () => {
    expect(sink.badges).toEqual([0]);

    const item = await deliver('API is down');

    await settle();
    expect(sink.notices).toEqual([
      { itemId: item.id, title: 'API is down', body: 'Monitoring · Alerts\nAPI is down' },
    ]);
    expect(sink.badges).toEqual([0, 1]);
  });

  test('Undecided and old items are not announced; done items lower the count', async () => {
    await deliver('Weekly digest');

    await deliver('DB was down last night', new Date(Date.now() - 2 * 60 * 60 * 1000));
    await settle();
    expect(sink.notices).toHaveLength(1);
    expect(sink.badges).toEqual([0, 1, 2]);

    const [important] = await container.inboxService.list({ category: Category.Important });

    await container.inboxService.done(important?.id ?? '');
    await settle();
    expect(sink.badges.at(-1)).toBeLessThan(2);
  });
});
