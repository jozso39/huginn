import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { MockConnectorFactory } from '@/core/connectors/Connector.mock';
import type { Item } from '@/core/items/Item.types';
import { Category, ItemKind } from '@/core/items/Item.types';
import {
  ConditionOp,
  DecisionSource,
  RuleKind,
  RuleOrigin,
  RuleStatus,
  RuleVerdict,
} from '@/core/triage/Rule.types';
import { MoveDirection } from '@/core/services/RuleService/RuleService.types';
import { createTestContainer } from '@/dependency/container/testContainer';
import type { Container } from '@/dependency/container/container.types';
import { MockJevClient } from '@/core/clients/JevClient/JevClient.mock';

describe('TriageService', () => {
  const jev = new MockJevClient();
  const mail = new MockConnectorFactory(ConnectorKind.Gmail);
  let container: Container;
  let connectionId: string;
  let counter = 0;

  const deliver = (title: string, features: Item['features'] = {}) =>
    mail.deliver({
      connectionId,
      externalId: `m${++counter}`,
      threadKey: `t${counter}`,
      kind: ItemKind.Email,
      author: 'someone',
      title,
      body: title,
      url: null,
      receivedAt: new Date(),
      features,
      raw: {},
    });

  const user = { origin: RuleOrigin.User };

  /** Rule changes re-sort waiting items in the background; let that finish. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  beforeAll(async () => {
    container = createTestContainer({ jev, connectorFactories: [mail] });
    // A test source has no default rules: each test adds what it needs.
    connectionId = (
      await container.connectionService.create({
        kind: ConnectorKind.Gmail,
        name: 'Mail',
        config: {},
        secrets: {},
      })
    ).id;
  });

  afterAll(async () => {
    await container.connectorHost.stopAll();
    container.close();
  });

  test('with no rules everything is Undecided, and says so', async () => {
    const item = await deliver('Hello');

    expect(item.category).toBe(Category.Undecided);
    expect(item.decision?.source).toBe(DecisionSource.NoRule);
  });

  test('the first rule in priority order decides, and is named', async () => {
    await container.ruleService.create(
      connectionId,
      {
        name: 'Bulk is spam',
        verdict: RuleVerdict.Spam,
        kind: RuleKind.Hard,
        predicate: { field: 'isBulk', op: ConditionOp.IsTrue },
      },
      user
    );
    await container.ruleService.create(
      connectionId,
      {
        name: 'Invoices matter',
        verdict: RuleVerdict.Important,
        kind: RuleKind.Hard,
        predicate: { field: 'title', op: ConditionOp.Contains, value: 'invoice' },
      },
      user
    );

    const invoice = await deliver('Your invoice', { isBulk: true });

    expect(invoice.category).toBe(Category.Spam);
    expect(invoice.decision?.ruleName).toBe('Bulk is spam');

    // Move "Invoices matter" above the bulk rule: now it wins.
    const rules = await container.ruleService.list(connectionId);

    await container.ruleService.move(rules[1]?.id ?? '', MoveDirection.Up);

    const again = await container.triageService.classify(invoice);

    expect(again.ruleName).toBe('Invoices matter');
    expect(again.category).toBe(Category.Important);
  });

  test('soft rules ask Jev once, for all of them, only when reached', async () => {
    await container.ruleService.create(
      connectionId,
      {
        name: 'Asks me',
        verdict: RuleVerdict.Important,
        kind: RuleKind.Soft,
        criterion: 'This email asks me to do something.',
      },
      user
    );
    await container.ruleService.create(
      connectionId,
      {
        name: 'Newsletter',
        verdict: RuleVerdict.Spam,
        kind: RuleKind.Soft,
        criterion: 'This email is a newsletter.',
        threshold: 0.8,
      },
      user
    );
    jev.answer = (state, question) =>
      question.includes('newsletter') && String(state.title).includes('Weekly') ? 0.9 : 0.2;
    await settle();

    const before = jev.calls;
    const newsletter = await deliver('Weekly digest');

    expect(newsletter.category).toBe(Category.Spam);
    expect(newsletter.decision?.ruleName).toBe('Newsletter');
    expect(Object.keys(newsletter.decision?.probabilities ?? {})).toHaveLength(2);
    expect(jev.calls - before).toBe(1);

    // A hard rule that fires first means Jev is not asked at all.
    const bulk = await deliver('Weekly digest', { isBulk: true });

    expect(bulk.decision?.ruleName).toBe('Bulk is spam');
    expect(jev.calls - before).toBe(1);
  });

  test('without an AI key, sentence rules are skipped and the item says why', async () => {
    jev.isAvailable = false;

    const item = await deliver('Weekly digest');

    expect(item.category).toBe(Category.Undecided);
    expect(item.decision?.source).toBe(DecisionSource.NoAiKey);
    jev.isAvailable = true;
  });

  test('when Jev does not answer, the item says the classifier was unreachable', async () => {
    const answer = jev.answer;

    jev.answer = () => {
      throw new Error('timeout');
    };

    const item = await deliver('Weekly digest again');

    expect(item.category).toBe(Category.Undecided);
    expect(item.decision?.source).toBe(DecisionSource.ClassifierUnavailable);
    jev.answer = answer;
  });

  test('re-triage moves waiting items after a rule change but never touches a hand-sorted one', async () => {
    const hello = await deliver('Hello again');
    const handSorted = await container.feedbackService.mark(hello.id, RuleVerdict.Important, '');

    expect(handSorted.item.decision?.source).toBe(DecisionSource.User);

    const rule = await container.ruleService.create(
      connectionId,
      {
        name: 'Hello is spam',
        verdict: RuleVerdict.Spam,
        kind: RuleKind.Hard,
        predicate: { field: 'title', op: ConditionOp.StartsWith, value: 'hello' },
      },
      user
    );

    await container.triageService.retriage(connectionId);

    const items = await container.inboxService.list({ connectionId });
    const firstHello = items.find((item) => item.title === 'Hello');
    const kept = items.find((item) => item.id === hello.id);

    expect(firstHello?.decision?.ruleId).toBe(rule.id);
    expect(kept?.category).toBe(Category.Important);

    // Hits count new arrivals the rule sorted, not re-sorts of old ones.
    expect((await container.ruleService.get(rule.id))?.hits).toBe(0);
    await deliver('Hello there');
    expect((await container.ruleService.get(rule.id))?.hits).toBe(1);
  });

  test('dry run shows where a draft fires and counts disagreements with hand-sorted items', async () => {
    const result = await container.triageService.dryRun(connectionId, {
      name: 'Anything titled hello',
      verdict: RuleVerdict.Spam,
      kind: RuleKind.Hard,
      predicate: { field: 'title', op: ConditionOp.Contains, value: 'hello' },
    });

    expect(result.hits.map((hit) => hit.title).sort()).toEqual([
      'Hello',
      'Hello again',
      'Hello there',
    ]);
    expect(result.conflicts).toBe(1);
  });

  test('proposed and disabled rules do not decide anything', async () => {
    const rule = await container.ruleService.create(
      connectionId,
      {
        name: 'Everything important',
        verdict: RuleVerdict.Important,
        kind: RuleKind.Hard,
        predicate: { field: 'kind', op: ConditionOp.Equals, value: 'Email' },
      },
      { ...user, status: RuleStatus.Proposed, priority: 1 }
    );
    const item = await deliver('Unrelated');

    expect(item.decision?.ruleId).not.toBe(rule.id);
  });

  test('bad drafts are refused with the reason', () => {
    expect(() =>
      container.ruleService.validate({
        name: 'x',
        verdict: RuleVerdict.Spam,
        kind: RuleKind.Soft,
        criterion: 'short',
      })
    ).toThrow('invalid rule');
  });
});
