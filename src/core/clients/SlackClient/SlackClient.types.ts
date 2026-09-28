/** The fields of a Slack `message` event Huginn reads. Names follow the Events API. */
export interface SlackMessageEvent {
  readonly type: 'message';
  readonly channel: string;
  readonly channel_type?: 'channel' | 'group' | 'im' | 'mpim';
  readonly user?: string;
  readonly bot_id?: string;
  readonly username?: string;
  readonly text?: string;
  readonly ts: string;
  readonly thread_ts?: string;
  readonly subtype?: string;
  readonly hidden?: boolean;
  readonly files?: readonly { readonly name?: string }[];
  /** Present on `message_changed`: the edited message. */
  readonly message?: Omit<SlackMessageEvent, 'channel' | 'message'>;
}

export interface SlackIdentity {
  readonly userId: string;
  readonly teamId: string;
  /** e.g. https://acme.slack.com/ — the base for deep links. */
  readonly teamUrl: string;
}

export interface SlackChannelInfo {
  readonly id: string;
  readonly name: string;
  readonly isIm: boolean;
  readonly isMpim: boolean;
}

export interface SlackUserGroup {
  readonly id: string;
  /** Without the @, e.g. "backend". */
  readonly handle: string;
}

export interface SlackPostedMessage {
  readonly channel: string;
  readonly ts: string;
}

export type SlackMessageHandler = (event: SlackMessageEvent) => void;

/**
 * Everything Huginn does with Slack, acting as the user (user token) and
 * listening over Socket Mode (app token). No public URL is involved.
 */
export interface ISlackClient {
  identify(): Promise<SlackIdentity>;
  /** User groups (`@backend`) the user belongs to; empty if the scope is missing. */
  myUserGroups(userId: string): Promise<readonly SlackUserGroup[]>;
  userName(userId: string): Promise<string>;
  channelInfo(channelId: string): Promise<SlackChannelInfo>;
  /** Public and private channels the user is a member of (not DMs). */
  myChannels(): Promise<readonly SlackChannelInfo[]>;
  postMessage(channel: string, text: string, threadTs?: string): Promise<SlackPostedMessage>;
  addReaction(channel: string, ts: string, emoji: string): Promise<void>;
  listen(onMessage: SlackMessageHandler): Promise<void>;
  close(): Promise<void>;
}
