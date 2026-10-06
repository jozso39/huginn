import type {
  ISlackClient,
  SlackChannelInfo,
  SlackIdentity,
  SlackMessageEvent,
  SlackPostedMessage,
  SlackSearchMatch,
  SlackSearchPage,
  SlackUserGroup,
} from '@/core/clients/SlackClient/SlackClient.types';
import type { SlackTokens } from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';

export const MOCK_SLACK_ME = 'UME';

/** A DM from the boss, the event the whole project started from. */
export const MOCK_SLACK_DM: SlackMessageEvent = {
  type: 'message',
  channel: 'DBOSS',
  channel_type: 'im',
  user: 'UBOSS',
  text: 'Hi <@UME>, can you clean up the old worktrees in ai-service?',
  ts: '1759046400.000100',
};

/**
 * Google Calendar's morning agenda: the text is only a heading, each event is a
 * legacy attachment with a date token, a link and an RSVP button.
 */
export const MOCK_SLACK_AGENDA: SlackMessageEvent = {
  type: 'message',
  channel: 'DCAL',
  channel_type: 'im',
  bot_id: 'BCAL',
  username: 'Google Calendar',
  text: '*Today*-<!date^1790805600^{date_long_pretty}|Thursday, October 1st>',
  ts: '1790832650.068969',
  blocks: [{ type: 'rich_text', elements: [] }],
  attachments: [
    {
      color: '3AA3E3',
      fallback: 'standup',
      text: '<!date^1790838900^{time}|9:15>-<!date^1790839800^{time}|9:30> *<https://www.google.com/calendar/event?eid=abc|Daily DEV standup>*\n*Going?* Yes',
    },
    {
      color: 'good',
      title: 'Release',
      title_link: 'javascript:alert(1)',
      fields: [{ title: 'Owner', value: 'Jana' }],
    },
    { color: 'url(evil)', fallback: 'Only a summary here' },
    {
      fallback: '[no preview available]',
      actions: [
        { text: 'Join Google Meet', url: 'https://meet.google.com/abc' },
        { text: 'Change Response' },
      ],
    },
  ],
};

/** An app's DM whose preview is Block Kit inside the attachment, as ClickUp sends them. */
export const MOCK_SLACK_APP_PREVIEW: SlackMessageEvent = {
  type: 'message',
  channel: 'DCU',
  channel_type: 'im',
  bot_id: 'BCU',
  username: 'ClickUp',
  text: '*Petra* mentioned you in a comment in *Banner copy*.',
  ts: '1790850000.000100',
  blocks: [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Petra* mentioned you in a comment in *Banner copy*.' },
    },
  ],
  attachments: [
    {
      color: '#d33d44',
      fallback: '[no preview available]',
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: ":speech_balloon: Petra's Comment on <https://app.clickup.com/t/1|Banner copy>",
            },
          ],
        },
        { type: 'section', text: { type: 'mrkdwn', text: 'Version 1.0 of the banner text.' } },
        {
          type: 'context',
          elements: [{ type: 'image' }, { type: 'mrkdwn', text: 'in AI summary' }],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View comment' },
              url: 'https://app.clickup.com/t/1?comment=2',
            },
            { type: 'button', text: { type: 'plain_text', text: 'Resolve' } },
          ],
        },
      ],
    },
    // A shared Slack message: its text, plus rich_text blocks that only repeat it.
    {
      author_name: 'Jana',
      text: 'Can you check the *invoices*?',
      fallback: '[October 3rd] jana: Can you check the invoices?',
      blocks: [{ type: 'rich_text', elements: [] }],
    },
    // The same, sent through an app, which signs it below the text.
    {
      author_name: 'Jana',
      text: 'And the *SMS* ones?',
      fallback: '[October 3rd] jana: And the SMS ones?',
      blocks: [
        { type: 'rich_text', elements: [] },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '*Sent using* <@UAPP>' }] },
      ],
    },
  ],
};

/** A message as Slack's search finds it; the thread is only in the permalink, as at Slack. */
const asMatch = (event: SlackMessageEvent): SlackSearchMatch => ({
  ...(event as object),
  ts: event.ts,
  channel: {
    id: event.channel,
    is_im: event.channel_type === 'im',
    is_mpim: event.channel_type === 'mpim',
    is_private: event.channel_type === 'group',
  },
  user: event.user,
  username: event.username,
  text: event.text,
  permalink: `https://acme.slack.com/archives/${event.channel}/p${event.ts.replace('.', '')}${
    event.thread_ts && event.thread_ts !== event.ts ? `?thread_ts=${event.thread_ts}` : ''
  }`,
});

/**
 * A workspace in memory: what `deliver` posts, search finds (newest first, 100 a page).
 * It starts with MOCK_SLACK_DM, the message the whole project started from.
 */
export class MockSlackClient implements ISlackClient {
  public identify(): Promise<SlackIdentity> {
    return Promise.resolve({
      userId: MOCK_SLACK_ME,
      teamId: 'T1',
      teamUrl: 'https://acme.slack.com/',
    });
  }

  public myUserGroups(_userId: string): Promise<readonly SlackUserGroup[]> {
    return Promise.resolve([{ id: 'SBACKEND', handle: 'backend' }]);
  }

  public userName(userId: string): Promise<string> {
    return Promise.resolve(
      userId === 'UBOSS' ? 'The Boss' : userId === MOCK_SLACK_ME ? 'jozef' : userId
    );
  }

  /** Read markers per channel; tests set them. */
  public readMarkers: ReadonlyMap<string, string> = new Map();

  public lastRead(channelId: string): Promise<string | null> {
    return Promise.resolve(this.readMarkers.get(channelId) ?? null);
  }

  public channelInfo(channelId: string): Promise<SlackChannelInfo> {
    return Promise.resolve({
      id: channelId,
      name: channelId.startsWith('D') ? 'direct message' : 'general',
      isIm: channelId.startsWith('D'),
      isMpim: false,
    });
  }

  public myChannels(): Promise<readonly SlackChannelInfo[]> {
    return Promise.resolve([
      { id: 'CGEN', name: 'general', isIm: false, isMpim: false },
      { id: 'CWATCH', name: 'releases', isIm: false, isMpim: false },
      { id: 'CRANDOM', name: 'random', isIm: false, isMpim: false },
    ]);
  }

  /** Messages sent through the client, oldest first. */
  public posted: readonly { channel: string; text: string; threadTs?: string }[] = [];

  public postMessage(
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<SlackPostedMessage> {
    this.posted = [...this.posted, { channel, text, threadTs }];

    return Promise.resolve({ channel, ts: '1759046500.000200' });
  }

  /** Reactions added through the client (Slack short names), oldest first. */
  public reactions: readonly { channel: string; ts: string; name: string }[] = [];

  public addReaction(channel: string, ts: string, name: string): Promise<void> {
    this.reactions = [...this.reactions, { channel, ts, name }];

    return Promise.resolve();
  }

  /** Everything posted to the workspace, as events; search finds them. */
  public messages: readonly SlackMessageEvent[] = [MOCK_SLACK_DM];
  public searches = 0;
  private tokensHandler: ((tokens: SlackTokens) => Promise<void>) | null = null;

  /** Set to play Slack refusing the search (a token without search:read, say). */
  public searchFails: Error | null = null;

  public search(_query: string, page: number): Promise<SlackSearchPage> {
    const newestFirst = [...this.messages].sort((a, b) => Number(b.ts) - Number(a.ts));

    this.searches += 1;

    if (this.searchFails) {
      return Promise.reject(this.searchFails);
    }

    return Promise.resolve({
      matches: newestFirst.slice((page - 1) * 100, page * 100).map(asMatch),
      pages: Math.max(1, Math.ceil(newestFirst.length / 100)),
    });
  }

  public message(
    channel: string,
    ts: string,
    _threadTs: string | null
  ): Promise<SlackMessageEvent | null> {
    return Promise.resolve(
      this.messages.find((event) => event.channel === channel && event.ts === ts) ?? null
    );
  }

  /** A new message in the workspace; the next check finds it. */
  public deliver(event: SlackMessageEvent): void {
    this.messages = [...this.messages, event];
  }

  public onTokens(handler: (tokens: SlackTokens) => Promise<void>): void {
    this.tokensHandler = handler;
  }

  /** Plays the client refreshing rotating tokens. */
  public rotate(tokens: SlackTokens): Promise<void> {
    return this.tokensHandler?.(tokens) ?? Promise.resolve();
  }
}
