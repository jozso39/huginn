import type { SlackTokens } from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';

/** The fields of a Slack `message` event Huginn reads. Names follow the Events API. */
/** A legacy message attachment: the coloured side-bar box apps (Google Calendar, Jira…) send. */
export interface SlackAttachment {
  readonly color?: string;
  readonly pretext?: string;
  readonly author_name?: string;
  readonly title?: string;
  readonly title_link?: string;
  readonly text?: string;
  readonly fallback?: string;
  readonly fields?: readonly { readonly title?: string; readonly value?: string }[];
  readonly footer?: string;
  /** Buttons; only those with a `url` mean anything outside Slack. */
  readonly actions?: readonly { readonly text?: string; readonly url?: string }[];
  /**
   * Block Kit instead of the fields above (ClickUp builds its previews this way). Shared
   * messages carry `rich_text` blocks too, but those only repeat `text`.
   */
  readonly blocks?: readonly SlackBlock[];
}

/** A Block Kit element: a context line's text, an image, or a button (whose label is an object). */
export interface SlackTextStyle {
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strike?: boolean;
  readonly code?: boolean;
}

/**
 * A block's element: a context line's text, a button, or a piece of `rich_text`, whose
 * containers (section, list, quote, preformatted) hold the inline pieces (text, link,
 * user, channel, emoji, …).
 */
export interface SlackBlockElement {
  readonly type: string;
  readonly text?: string | { readonly type: string; readonly text: string };
  readonly url?: string;
  readonly elements?: readonly SlackBlockElement[];
  /** A text piece's styling, or a list's kind ("bullet", "ordered"). */
  readonly style?: SlackTextStyle | string;
  readonly indent?: number;
  readonly user_id?: string;
  readonly channel_id?: string;
  readonly usergroup_id?: string;
  /** An emoji's short name. */
  readonly name?: string;
  /** A broadcast's reach: here, channel, everyone. */
  readonly range?: string;
  /** What to show for a piece Huginn does not know, such as a date. */
  readonly fallback?: string;
}

/**
 * The subset of Block Kit Huginn reads: text in sections, headers, context lines and
 * tables (cells are `rich_text` or `raw_text`), link buttons.
 */
export interface SlackBlock {
  readonly type: string;
  readonly text?: { readonly type: string; readonly text: string };
  readonly fields?: readonly { readonly type: string; readonly text: string }[];
  readonly elements?: readonly SlackBlockElement[];
  /** A section's element on the side, e.g. a link button. */
  readonly accessory?: SlackBlockElement;
  readonly rows?: readonly (readonly SlackBlockElement[])[];
}

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
  readonly attachments?: readonly SlackAttachment[];
  readonly blocks?: readonly SlackBlock[];
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

/** A message as Slack's search returns it: enough to decide whether it matters. */
export interface SlackSearchMatch {
  readonly ts: string;
  readonly channel: {
    readonly id: string;
    readonly name?: string;
    readonly is_im?: boolean;
    readonly is_mpim?: boolean;
    readonly is_private?: boolean;
  };
  readonly user?: string;
  readonly username?: string;
  readonly text?: string;
  /** For a thread reply it carries `thread_ts`, which the match itself does not. */
  readonly permalink?: string;
}

export interface SlackSearchPage {
  readonly matches: readonly SlackSearchMatch[];
  /** How many pages the whole result has. */
  readonly pages: number;
}

/**
 * Everything Huginn does with Slack, as the signed-in person with their own token.
 * Nothing is pushed: Huginn asks, so one company Slack app can serve everyone without
 * anyone's messages reaching anyone else.
 */
export interface ISlackClient {
  identify(): Promise<SlackIdentity>;
  /** User groups (`@backend`) the user belongs to; empty if the scope is missing. */
  myUserGroups(userId: string): Promise<readonly SlackUserGroup[]>;
  userName(userId: string): Promise<string>;
  channelInfo(channelId: string): Promise<SlackChannelInfo>;
  /** The user's read marker in a conversation (a message ts); null if Slack gives none. */
  lastRead(channelId: string): Promise<string | null>;
  /** Public and private channels the user is a member of (not DMs). */
  myChannels(): Promise<readonly SlackChannelInfo[]>;
  /** Messages the user can see that match `query`, newest first, 100 a page (page 1…). */
  search(query: string, page: number): Promise<SlackSearchPage>;
  /** One whole message (blocks, attachments, files) by where it is; null if it is gone. */
  message(channel: string, ts: string, threadTs: string | null): Promise<SlackMessageEvent | null>;
  postMessage(channel: string, text: string, threadTs?: string): Promise<SlackPostedMessage>;
  addReaction(channel: string, ts: string, emoji: string): Promise<void>;
  /** Told whenever rotating tokens were refreshed, so the new ones can be kept. */
  onTokens(handler: (tokens: SlackTokens) => Promise<void>): void;
}
