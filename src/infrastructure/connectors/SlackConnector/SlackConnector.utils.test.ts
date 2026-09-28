import { describe, expect, test } from 'bun:test';
import type { SlackMessageEvent } from '@/core/clients/SlackClient/SlackClient.types';
import { ItemKind } from '@/core/items/Item.types';
import { SlackChannelScope } from './SlackConnector.types';
import type { RelevanceContext } from './SlackConnector.utils';
import {
  SlackRelevance,
  classify,
  itemKindFor,
  normalizeEvent,
  parseChannelList,
  permalink,
  referencedUserIds,
  resolveChannels,
  replyThreadTs,
  threadKeyOf,
  toPlainText,
} from './SlackConnector.utils';

const ctx: RelevanceContext = {
  me: 'UME',
  myGroupIds: new Set(['SBACKEND']),
  channelScope: SlackChannelScope.AddressedToMe,
  watchedChannels: new Set(['CWATCH']),
  ignoredChannels: new Set(['CRANDOM']),
  myThreads: new Set(['CGEN:1700000000.000100']),
};

const message = (overrides: Partial<SlackMessageEvent>): SlackMessageEvent => ({
  type: 'message',
  channel: 'CGEN',
  channel_type: 'channel',
  user: 'UBOSS',
  text: 'hello',
  ts: '1700000500.000200',
  ...overrides,
});

describe('classify', () => {
  test('a DM from the boss is a direct message', () => {
    const dm = message({ channel: 'DBOSS', channel_type: 'im', text: 'Can you clean the repo?' });

    expect(classify(dm, ctx)).toBe(SlackRelevance.DirectMessage);
    expect(itemKindFor(SlackRelevance.DirectMessage)).toBe(ItemKind.DirectMessage);
  });

  test('my own message answers the conversation', () => {
    expect(classify(message({ user: 'UME' }), ctx)).toBe(SlackRelevance.Own);
  });

  test('personal and group mentions both count', () => {
    expect(classify(message({ text: 'ping <@UME>' }), ctx)).toBe(SlackRelevance.Mention);
    expect(classify(message({ text: '<!subteam^SBACKEND|@backend> deploy?' }), ctx)).toBe(
      SlackRelevance.Mention
    );
  });

  test('replies in threads I wrote in, and watched channels, are kept; the rest is ignored', () => {
    expect(classify(message({ thread_ts: '1700000000.000100' }), ctx)).toBe(
      SlackRelevance.ThreadReply
    );
    expect(classify(message({ channel: 'CWATCH' }), ctx)).toBe(SlackRelevance.ChannelMessage);
    expect(classify(message({ thread_ts: '1600000000.000001' }), ctx)).toBe(SlackRelevance.Ignore);
  });
});

describe('all-my-channels scope', () => {
  const all = { ...ctx, channelScope: SlackChannelScope.AllMyChannels };

  test('keeps every channel except the ignored ones', () => {
    expect(classify(message({ channel: 'CGEN' }), all)).toBe(SlackRelevance.ChannelMessage);
    expect(classify(message({ channel: 'CRANDOM' }), all)).toBe(SlackRelevance.Ignore);
  });

  test('a mention still gets through an ignored channel, like a muted one in Slack', () => {
    expect(classify(message({ channel: 'CRANDOM', text: 'hey <@UME>' }), all)).toBe(
      SlackRelevance.Mention
    );
  });
});

describe('channel lists', () => {
  const channels = [
    { id: 'CGEN0001', name: 'general', isIm: false, isMpim: false },
    { id: 'CREL0001', name: 'Releases', isIm: false, isMpim: false },
  ];

  test('accepts #names, bare names and IDs, and reports what it cannot find', () => {
    const resolved = resolveChannels(
      parseChannelList(' #general, releases ,C084MR7P2UR, #nope,, '),
      channels
    );

    expect([...resolved.ids].sort()).toEqual(['C084MR7P2UR', 'CGEN0001', 'CREL0001']);
    expect(resolved.unknown).toEqual(['#nope']);
  });
});

describe('normalizeEvent', () => {
  test('drops joins and hidden events, unwraps edits', () => {
    expect(normalizeEvent(message({ subtype: 'channel_join' }))).toBeNull();
    expect(normalizeEvent(message({ hidden: true }))).toBeNull();

    const edited = normalizeEvent(
      message({
        subtype: 'message_changed',
        message: { type: 'message', user: 'UBOSS', text: 'edited <@UME>', ts: '1700000500.000200' },
      })
    );

    expect(edited?.text).toBe('edited <@UME>');
    expect(edited?.channel).toBe('CGEN');
  });
});

describe('threads, links and replies', () => {
  test('DMs group per conversation, channels per thread', () => {
    expect(threadKeyOf(message({ channel: 'D1', channel_type: 'im' }))).toBe('D1');
    expect(threadKeyOf(message({}))).toBe('CGEN:1700000500.000200');
    expect(threadKeyOf(message({ thread_ts: '1700000000.000100' }))).toBe('CGEN:1700000000.000100');
  });

  test('permalinks point at the message, with thread params for replies', () => {
    expect(permalink('https://acme.slack.com/', message({}))).toBe(
      'https://acme.slack.com/archives/CGEN/p1700000500000200'
    );
    expect(permalink('https://acme.slack.com', message({ thread_ts: '1700000000.000100' }))).toBe(
      'https://acme.slack.com/archives/CGEN/p1700000500000200?thread_ts=1700000000.000100&cid=CGEN'
    );
  });

  test('replies go into the thread, except in an unthreaded DM', () => {
    expect(replyThreadTs(message({}))).toBe('1700000500.000200');
    expect(replyThreadTs(message({ thread_ts: '1700000000.000100' }))).toBe('1700000000.000100');
    expect(replyThreadTs(message({ channel_type: 'im' }))).toBeUndefined();
  });
});

describe('toPlainText', () => {
  test('resolves references and unescapes', () => {
    const text =
      'Hi <@UME>, see <#C1|general> and <https://x.io|the doc> &amp; <https://y.io> <!here> <!subteam^S1|@backend>';
    const names = new Map([['UME', 'jozef']]);

    expect(referencedUserIds(text)).toEqual(['UME']);
    expect(toPlainText(text, names)).toBe(
      'Hi @jozef, see #general and the doc & https://y.io @here @backend'
    );
  });
});
