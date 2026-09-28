import type { SlackMessageEvent } from '@/core/clients/SlackClient/SlackClient.types';
import { ItemKind } from '@/core/items/Item.types';

/** Subtypes that are real messages from a person or bot. Everything else is noise. */
const CONTENT_SUBTYPES = new Set([
  undefined,
  'thread_broadcast',
  'file_share',
  'bot_message',
  'me_message',
]);

export interface RelevanceContext {
  readonly me: string;
  readonly myGroupIds: ReadonlySet<string>;
  readonly watchedChannels: ReadonlySet<string>;
  /** `channel:thread_ts` of threads the user wrote in. */
  readonly myThreads: ReadonlySet<string>;
}

export enum SlackRelevance {
  /** The user wrote it: their conversation is answered. */
  Own = 'Own',
  DirectMessage = 'DirectMessage',
  Mention = 'Mention',
  ThreadReply = 'ThreadReply',
  WatchedChannel = 'WatchedChannel',
  Ignore = 'Ignore',
}

/** `message_changed` carries the edited message inside; flatten it to one shape. */
export const normalizeEvent = (event: SlackMessageEvent): SlackMessageEvent | null => {
  if (event.subtype === 'message_changed') {
    return event.message
      ? { ...event.message, channel: event.channel, channel_type: event.channel_type }
      : null;
  }

  if (event.hidden || !CONTENT_SUBTYPES.has(event.subtype)) {
    return null;
  }

  return event;
};

export const threadKeyOf = (event: SlackMessageEvent): string => {
  // A DM without threads is one running conversation; group all of it together.
  if (!event.thread_ts && (event.channel_type === 'im' || event.channel_type === 'mpim')) {
    return event.channel;
  }

  return `${event.channel}:${event.thread_ts ?? event.ts}`;
};

export const mentionsMe = (text: string, ctx: RelevanceContext): boolean =>
  text.includes(`<@${ctx.me}>`) ||
  [...ctx.myGroupIds].some((groupId) => text.includes(`<!subteam^${groupId}`));

export const classify = (event: SlackMessageEvent, ctx: RelevanceContext): SlackRelevance => {
  if (event.user === ctx.me) {
    return SlackRelevance.Own;
  }

  const text = event.text ?? '';

  if (event.channel_type === 'im' || event.channel_type === 'mpim') {
    return SlackRelevance.DirectMessage;
  }

  if (mentionsMe(text, ctx)) {
    return SlackRelevance.Mention;
  }

  if (event.thread_ts && ctx.myThreads.has(`${event.channel}:${event.thread_ts}`)) {
    return SlackRelevance.ThreadReply;
  }

  if (ctx.watchedChannels.has(event.channel)) {
    return SlackRelevance.WatchedChannel;
  }

  return SlackRelevance.Ignore;
};

export const itemKindFor = (relevance: SlackRelevance): ItemKind => {
  switch (relevance) {
    case SlackRelevance.DirectMessage:
      return ItemKind.DirectMessage;
    case SlackRelevance.Mention:
      return ItemKind.Mention;
    default:
      return ItemKind.Message;
  }
};

/** https://team.slack.com/archives/C123/p1700000000123456 (+ thread params for replies). */
export const permalink = (teamUrl: string, event: SlackMessageEvent): string => {
  const base = `${teamUrl.replace(/\/$/, '')}/archives/${event.channel}/p${event.ts.replace('.', '')}`;

  return event.thread_ts && event.thread_ts !== event.ts
    ? `${base}?thread_ts=${event.thread_ts}&cid=${event.channel}`
    : base;
};

const USER_REF = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

export const referencedUserIds = (text: string): string[] => [
  ...new Set([...text.matchAll(USER_REF)].map((match) => match[1] ?? '')),
];

/**
 * Slack mrkdwn → readable plain text: user and channel references become names,
 * links become their label, and the three escaped characters are restored.
 */
export const toPlainText = (
  text: string,
  userNames: ReadonlyMap<string, string>,
  groupHandles: ReadonlyMap<string, string> = new Map()
): string =>
  text
    .replace(USER_REF, (_, id: string) => `@${userNames.get(id) ?? id}`)
    .replace(/<#[CG][A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(
      /<!subteam\^([A-Z0-9]+)(?:\|([^>]*))?>/g,
      (_, id: string, label?: string) =>
        label ?? (groupHandles.has(id) ? `@${groupHandles.get(id) ?? ''}` : '@group')
    )
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * Where a reply to this message belongs: in the thread if there is one, top level in a
 * DM that was not threaded, otherwise in a new thread under the message.
 */
export const replyThreadTs = (event: SlackMessageEvent): string | undefined => {
  if (event.thread_ts) {
    return event.thread_ts;
  }

  return event.channel_type === 'im' || event.channel_type === 'mpim' ? undefined : event.ts;
};
