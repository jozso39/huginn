import { describe, expect, test } from 'bun:test';
import { MOCK_SLACK_AGENDA } from '@/infrastructure/clients/SlackClient/SlackClient.mock';
import type { SlackMessageEvent } from '@/core/clients/SlackClient/SlackClient.types';
import { ItemKind } from '@/core/items/Item.types';
import { SlackChannelScope } from './SlackConnector.types';
import type { RelevanceContext } from './SlackConnector.utils';
import {
  channelsToCheck,
  readItemIds,
  attachmentViews,
  blocksText,
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

  test('replies always go into a thread, DMs included', () => {
    expect(replyThreadTs(message({}))).toBe('1700000500.000200');
    expect(replyThreadTs(message({ thread_ts: '1700000000.000100' }))).toBe('1700000000.000100');
    expect(replyThreadTs(message({ channel_type: 'im' }))).toBe('1700000500.000200');
  });
});

describe('toPlainText: dates, mailto, code and emphasis', () => {
  test('the message from the field reads like Slack shows it', () => {
    expect(
      toPlainText('*Today*-<!date^1790632800^{date_long}|Tuesday, September 29, 2026>', new Map())
    ).toBe('Today-Tuesday, September 29, 2026');
    expect(toPlainText('_really_ ~not~ this: <mailto:a@b.cz|mail me>', new Map())).toBe(
      'really not this: mail me'
    );
    expect(toPlainText('```x = 1```', new Map())).toBe('x = 1');
    expect(
      toPlainText('see <#C1> and <#C2|general>', new Map(), new Map(), new Map([['C1', 'dev']]))
    ).toBe('see #dev and #general');
    // Snake_case and a lone asterisk are not emphasis.
    expect(toPlainText('run my_long_name * 2', new Map())).toBe('run my_long_name * 2');
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

describe('attachments and blocks', () => {
  test('an agenda keeps each event box, with safe colours and links only', () => {
    const views = attachmentViews(MOCK_SLACK_AGENDA);

    expect(views).toHaveLength(4);
    expect(views[0]).toMatchObject({
      color: '#3AA3E3',
      text: expect.stringContaining('Daily DEV standup'),
    });
    // Named colour mapped; a javascript: link dropped; a field kept.
    expect(views[1]).toMatchObject({
      color: '#2eb67d',
      titleLink: null,
      fields: [{ title: 'Owner', value: 'Jana' }],
    });
    // Not a colour: no colour. Nothing but a fallback: the fallback is the text.
    expect(views[2]).toMatchObject({ color: null, text: 'Only a summary here' });
    // Buttons: only real links survive, and the empty fallback is not shown.
    expect(views[3]).toMatchObject({
      text: '',
      links: [{ text: 'Join Google Meet', url: 'https://meet.google.com/abc' }],
    });
  });

  test('app blocks are shown instead of the fallback text; rich_text blocks are not', () => {
    expect(blocksText(MOCK_SLACK_AGENDA.blocks)).toBeNull();
    expect(
      blocksText([
        { type: 'header', text: { type: 'plain_text', text: 'Deploy' } },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'api *green*' },
          fields: [{ type: 'mrkdwn', text: '*Env* prod' }],
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: 'by CI' },
            { type: 'image' },
            { type: 'mrkdwn', text: '2 min' },
          ],
        },
        { type: 'actions', elements: [{ type: 'button', text: 'Retry' }] },
      ])
    ).toBe('*Deploy*\napi *green*\n*Env* prod\nby CI · 2 min');
  });
});

describe('read in Slack', () => {
  const open = [
    // An unthreaded DM: its key is the channel.
    { externalId: 'D1:100.1', threadKey: 'D1' },
    { externalId: 'D1:300.1', threadKey: 'D1' },
    // A top-level channel message: its key is itself.
    { externalId: 'C1:150.1', threadKey: 'C1:150.1' },
    // A reply in a thread: the channel marker says nothing about it.
    { externalId: 'C1:120.1', threadKey: 'C1:90.1' },
  ];

  test('what the read marker has passed closes; newer messages and thread replies stay', () => {
    const markers = new Map([
      ['D1', '200.0'],
      ['C1', '160.0'],
    ]);

    expect(readItemIds(open, markers)).toEqual(['D1:100.1', 'C1:150.1']);
    expect(readItemIds(open, new Map([['D1', null]]))).toEqual([]);
  });

  test('only conversations with waiting top-level messages are asked about', () => {
    expect(channelsToCheck(open, 20)).toEqual(['D1', 'C1']);
    expect(channelsToCheck([{ externalId: 'C2:1.1', threadKey: 'C2:0.5' }], 20)).toEqual([]);
    expect(channelsToCheck(open, 1)).toEqual(['D1']);
  });
});
