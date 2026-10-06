import type {
  ISlackClient,
  SlackChannelInfo,
  SlackIdentity,
  SlackMessageEvent,
  SlackMessageHandler,
  SlackPostedMessage,
  SlackUserGroup,
} from '@/core/clients/SlackClient/SlackClient.types';

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

/**
 * Replays MOCK_SLACK_DM as soon as someone listens. Tests that need more events
 * keep the handler through `listen` and call it themselves via `deliver`.
 */
export class MockSlackClient implements ISlackClient {
  private handler: SlackMessageHandler | null = null;

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

  public listen(onMessage: SlackMessageHandler): Promise<void> {
    this.handler = onMessage;
    onMessage(MOCK_SLACK_DM);

    return Promise.resolve();
  }

  public deliver(event: SlackMessageEvent): void {
    this.handler?.(event);
  }

  public close(): Promise<void> {
    this.handler = null;

    return Promise.resolve();
  }
}
