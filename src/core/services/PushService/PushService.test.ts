import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MockPushClient } from '@/core/clients/PushClient/PushClient.mock';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { ItemKind } from '@/core/items/Item.types';
import { ConditionOp, RuleKind, RuleOrigin, RuleVerdict } from '@/core/triage/Rule.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';

/** Pushing runs off the event bus, after ingest returns. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const PHONE = 'https://web.push.apple.com/phone';
const OLD_LAPTOP = 'https://fcm.googleapis.com/fcm/send/old';

describe('PushService', () => {
  const push = new MockPushClient();
  let container: Container;
  let connectionId: string;
  let counter = 0;

  const ingest = (title: string, receivedAt = new Date()) =>
    container.inboxService.ingest({
      connectionId,
      externalId: `p${++counter}`,
      threadKey: `t${counter}`,
      kind: ItemKind.Alert,
      author: 'Monitoring',
      title,
      body: `${title}\n\nmore   detail`,
      url: null,
      receivedAt,
      features: {},
      raw: {},
    });

  beforeAll(async () => {
    container = createTestContainer({ push });
    container.pushService.start();
    connectionId = (
      await container.connectionService.create({
        kind: ConnectorKind.Ingest,
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
    await container.pushService.register({
      endpoint: PHONE,
      p256dh: 'k',
      auth: 'a',
      label: 'iPhone',
    });
  });

  afterAll(async () => {
    container.pushService.stop();
    await container.connectorHost.stopAll();
    container.close();
  });

  test('a new Important item reaches the phone, with a preview and the badge count', async () => {
    await ingest('API is down');
    await settle();

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.endpoint).toBe(PHONE);
    expect(push.sent[0]?.message).toMatchObject({
      title: 'API is down',
      body: 'Monitoring · Alerts\nAPI is down more detail',
      badge: 1,
    });
  });

  test('Undecided items and old ones from a first sync stay quiet', async () => {
    await ingest('Weekly digest');
    await ingest('DB was down last night', new Date(Date.now() - 2 * 60 * 60 * 1000));
    await settle();

    expect(push.sent).toHaveLength(1);
  });

  test('a browser that unsubscribed is forgotten on the next push', async () => {
    await container.pushService.register({
      endpoint: OLD_LAPTOP,
      p256dh: 'k',
      auth: 'a',
      label: 'Laptop',
    });
    push.goneEndpoints = new Set([OLD_LAPTOP]);

    await ingest('Queue is down');
    await settle();

    expect(push.sent.map((s) => s.endpoint)).toEqual([PHONE, PHONE]);
    expect((await container.pushService.devices()).map((d) => d.label)).toEqual(['iPhone']);
  });

  test('registering the same browser again replaces it; a test push goes to that device', async () => {
    await container.pushService.register({
      endpoint: PHONE,
      p256dh: 'k2',
      auth: 'a2',
      label: 'iPhone',
    });

    expect(await container.pushService.devices()).toHaveLength(1);
    expect(await container.pushService.test(PHONE)).toBe(true);
    expect(await container.pushService.test('https://web.push.apple.com/unknown')).toBe(false);
  });
});
