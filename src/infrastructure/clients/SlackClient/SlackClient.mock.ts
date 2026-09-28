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

  public postMessage(
    channel: string,
    _text: string,
    _threadTs?: string
  ): Promise<SlackPostedMessage> {
    return Promise.resolve({ channel, ts: '1759046500.000200' });
  }

  public addReaction(_channel: string, _ts: string, _emoji: string): Promise<void> {
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
