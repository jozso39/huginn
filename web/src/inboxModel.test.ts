import { describe, expect, test } from 'bun:test';
import type { Connection, Item } from './api.types';
import type { Outline, Thread } from './inboxModel';
import {
  counterpart,
  groupByThread,
  jumpTarget,
  previewOf,
  resolveSelection,
  shortTime,
  sidePanel,
  walkable,
} from './inboxModel';

let sequence = 0;

/** Newest first, like the API: call in the order the list should have. */
const item = (fields: Partial<Item> = {}): Item => {
  sequence += 1;

  return {
    id: `i${sequence}`,
    connectionId: 'slack',
    externalId: `e${sequence}`,
    threadKey: `t${sequence}`,
    kind: 'Message',
    author: 'Jana',
    title: 'Jana in #dev',
    body: 'Hello',
    url: null,
    appUrl: null,
    rich: null,
    status: null,
    receivedAt: new Date(Date.UTC(2026, 9, 7, 12, 0) - sequence * 60_000).toISOString(),
    features: {},
    category: 'Undecided',
    decidedByRuleId: null,
    decision: null,
    state: 'Open',
    stateChangedAt: '2026-10-07T12:00:00.000Z',
    createdAt: '2026-10-07T12:00:00.000Z',
    ...fields,
  };
};

const connection = (id: string, name: string, kind: Connection['kind']): Connection => ({
  id,
  kind,
  name,
  config: {},
  cursor: {},
  enabled: true,
  status: 'Running',
  statusMessage: null,
  lastSyncAt: null,
  groupId: null,
  color: '#3b82f6',
  createdAt: '2026-10-01T00:00:00.000Z',
});

const CONNECTIONS = [
  connection('slack', 'Work Slack', 'Slack'),
  connection('mail', 'Personal Gmail', 'Gmail'),
];

describe('the side panel', () => {
  test('lists Important, Undecided and Spam, each by connection name, newest first', () => {
    const slackLate = item({ category: 'Important' });
    const mail = item({ connectionId: 'mail', category: 'Important' });
    const slackEarly = item({ category: 'Important' });
    const undecided = item();
    const spam = item({ connectionId: 'mail', category: 'Spam' });
    const side = sidePanel([slackLate, mail, slackEarly, undecided, spam], CONNECTIONS);

    expect(side.map((c) => c.category)).toEqual(['Important', 'Undecided', 'Spam']);
    expect(side[0]?.connections.map((c) => c.connection?.name)).toEqual([
      'Personal Gmail',
      'Work Slack',
    ]);
    expect(side[0]?.threads.map((t) => t.items[0]?.id)).toEqual([
      mail.id,
      slackLate.id,
      slackEarly.id,
    ]);
    expect(side[1]?.threads.map((t) => t.items[0]?.id)).toEqual([undecided.id]);
    expect(side[2]?.threads.map((t) => t.items[0]?.id)).toEqual([spam.id]);
  });

  test('files a conversation by its newest message, as the inbox shows it', () => {
    const newer = item({ threadKey: 'x', category: 'Undecided' });
    const older = item({ threadKey: 'x', category: 'Important' });
    const side = sidePanel([newer, older], CONNECTIONS);

    expect(side[0]?.threads).toEqual([]);
    expect(side[1]?.threads.map((t) => t.items.map((i) => i.id))).toEqual([[newer.id, older.id]]);
  });
});

describe('walking the panels', () => {
  const [a, b, c, d] = groupByThread([item(), item(), item(), item()]) as [
    Thread,
    Thread,
    Thread,
    Thread,
  ];
  const outline: Outline[] = [
    { key: 'Important', threads: [a, b], open: true },
    { key: 'Undecided', threads: [], open: true },
    { key: 'Spam', threads: [c, d], open: false },
  ];

  test('↑ ↓ skip folded parts', () => {
    expect(walkable(outline)).toEqual([a, b]);
  });

  test('the selection stays on its message, or on its place once the message left', () => {
    const order = walkable(outline);

    expect(resolveSelection(order, b.items[0]?.id ?? null, 0)).toBe(1);
    expect(resolveSelection(order, 'gone', 1)).toBe(1);
    expect(resolveSelection(order, 'gone', 7)).toBe(1);
    expect(resolveSelection(order, null, 0)).toBe(0);
    expect(resolveSelection([], 'gone', 3)).toBe(-1);
  });

  test('⌘↓ goes to the first of the next part with messages, unfolding it', () => {
    expect(jumpTarget(outline, a, 1)).toEqual({ part: 'Spam', thread: c });
    expect(jumpTarget(outline, c, 1)).toBeNull();
  });

  test('⌘↑ goes to the first of the previous part; in the first part, to its top', () => {
    expect(jumpTarget(outline, d, -1)).toEqual({ part: 'Important', thread: a });
    expect(jumpTarget(outline, b, -1)).toEqual({ part: 'Important', thread: a });
    expect(jumpTarget(outline, undefined, 1)).toEqual({ part: 'Important', thread: a });
  });

  test('the other panel shows the conversation that holds any of its messages', () => {
    const newer = item({ threadKey: 'y', category: 'Undecided' });
    const older = item({ threadKey: 'y', category: 'Important' });
    const whole = groupByThread([newer, older]);
    const importantOnly = groupByThread([older]);

    expect(counterpart(importantOnly, whole[0])).toBe(importantOnly[0]);
    expect(counterpart(importantOnly, undefined)).toBeUndefined();
  });
});

describe('a message in the side panel', () => {
  test('a chat shows its first lines with emoji, and where it was said', () => {
    const preview = previewOf(
      item({
        body: ':credit_card: 950 CZK\npaid :not_an_emoji:',
        features: { channelName: 'paid-features' },
      }),
      'Slack'
    );

    expect(preview).toEqual({
      place: '#paid-features',
      subject: null,
      text: '💳 950 CZK paid :not_an_emoji:',
    });
  });

  test('a chat without text falls back to its title', () => {
    expect(previewOf(item({ body: '  ', title: 'Jana sent a file' }), 'Signal').text).toBe(
      'Jana sent a file'
    );
  });

  test('an e-mail shows its subject above its first lines', () => {
    const preview = previewOf(
      item({ kind: 'Email', title: 'Kroužek', body: 'Milí rodiče,\n\nzačíná říjen' }),
      'Gmail'
    );

    expect(preview).toEqual({ place: null, subject: 'Kroužek', text: 'Milí rodiče, začíná říjen' });
  });
});

describe('short times', () => {
  const now = new Date(2026, 9, 7, 15, 30);

  test('today: the time; this week: the day; before: the date', () => {
    const today = new Date(2026, 9, 7, 9, 5);
    const monday = new Date(2026, 9, 5, 9, 5);
    const september = new Date(2026, 8, 20, 9, 5);

    expect(shortTime(today.toISOString(), now)).toBe(
      today.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    );
    expect(shortTime(monday.toISOString(), now)).toBe(
      monday.toLocaleDateString(undefined, { weekday: 'short' })
    );
    expect(shortTime(september.toISOString(), now)).toBe(
      september.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    );
  });
});
