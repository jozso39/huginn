import type {
  SlackChannelInfo,
  SlackMessageEvent,
} from '@/core/clients/SlackClient/SlackClient.types';
import type { SlackAttachmentView } from '@/core/items/Item.types';
import { ItemKind } from '@/core/items/Item.types';
import { SlackChannelScope } from './SlackConnector.types';

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
  readonly channelScope: SlackChannelScope;
  /** Channel IDs; only consulted in AddressedToMe scope. */
  readonly watchedChannels: ReadonlySet<string>;
  /** Channel IDs; only consulted in AllMyChannels scope. */
  readonly ignoredChannels: ReadonlySet<string>;
  /** `channel:thread_ts` of threads the user wrote in. */
  readonly myThreads: ReadonlySet<string>;
}

export enum SlackRelevance {
  /** The user wrote it: their conversation is answered. */
  Own = 'Own',
  DirectMessage = 'DirectMessage',
  Mention = 'Mention',
  ThreadReply = 'ThreadReply',
  ChannelMessage = 'ChannelMessage',
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

  // Mentions and my threads came first on purpose: like Slack's own mute, ignoring a
  // channel silences its chatter, not someone asking me something directly.
  const channelWanted =
    ctx.channelScope === SlackChannelScope.AllMyChannels
      ? !ctx.ignoredChannels.has(event.channel)
      : ctx.watchedChannels.has(event.channel);

  return channelWanted ? SlackRelevance.ChannelMessage : SlackRelevance.Ignore;
};

const CHANNEL_ID = /^[CG][A-Z0-9]{6,}$/;

/** "a, #b, C0123ABCD" → the raw entries, trimmed. */
export const parseChannelList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

export interface ResolvedChannels {
  readonly ids: ReadonlySet<string>;
  /** Entries that matched no channel the user is in; worth telling them about. */
  readonly unknown: readonly string[];
}

/** Maps `#name`, `name` or an ID onto channel IDs, case-insensitively for names. */
export const resolveChannels = (
  entries: readonly string[],
  channels: readonly SlackChannelInfo[]
): ResolvedChannels => {
  const byName = new Map(channels.map((channel) => [channel.name.toLowerCase(), channel.id]));
  const resolved = entries.map((entry) => {
    if (CHANNEL_ID.test(entry)) {
      return { entry, id: entry };
    }

    return { entry, id: byName.get(entry.replace(/^#/, '').toLowerCase()) };
  });

  return {
    ids: new Set(resolved.flatMap((r) => (r.id ? [r.id] : []))),
    unknown: resolved.filter((r) => !r.id).map((r) => r.entry),
  };
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
const CHANNEL_REF = /<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g;

export const referencedUserIds = (text: string): string[] => [
  ...new Set([...text.matchAll(USER_REF)].map((match) => match[1] ?? '')),
];

/** Channels referenced without a name (`<#C123>`), which Slack expects the client to look up. */
export const referencedChannelIds = (text: string): string[] => [
  ...new Set([...text.matchAll(CHANNEL_REF)].filter((m) => !m[2]).map((match) => match[1] ?? '')),
];

/**
 * Slack mrkdwn → readable plain text: user and channel references become names,
 * links become their label, and the three escaped characters are restored.
 */
export const toPlainText = (
  text: string,
  userNames: ReadonlyMap<string, string>,
  groupHandles: ReadonlyMap<string, string> = new Map(),
  channelNames: ReadonlyMap<string, string> = new Map()
): string =>
  text
    .replace(/```/g, '')
    // Dates: the fallback text is Slack's own plain rendering.
    .replace(/<!date\^[^|>]*\|([^>]*)>/g, '$1')
    .replace(USER_REF, (_, id: string) => `@${userNames.get(id) ?? id}`)
    .replace(
      CHANNEL_REF,
      (_, id: string, label?: string) => `#${label ?? channelNames.get(id) ?? id}`
    )
    .replace(
      /<!subteam\^([A-Z0-9]+)(?:\|([^>]*))?>/g,
      (_, id: string, label?: string) =>
        label ?? (groupHandles.has(id) ? `@${groupHandles.get(id) ?? ''}` : '@group')
    )
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<mailto:([^>]+)>/g, '$1')
    .replace(/<(https?:[^>]+)>/g, '$1')
    // Emphasis markers at word boundaries, as Slack reads them.
    .replace(/(^|[\s([{"'])([*_~])(\S(?:[^\n]*?\S)?)\2(?=$|[^\p{L}\p{N}])/gmu, '$1$3')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * Where a reply to this message belongs: always in a thread — the existing one, or a new
 * one under the message. Also in DMs: a threaded answer says which message it answers.
 */
export const replyThreadTs = (event: SlackMessageEvent): string => event.thread_ts ?? event.ts;

// Slack's named attachment colours.
const NAMED_COLORS: Readonly<Record<string, string>> = {
  good: '#2eb67d',
  warning: '#ecb22e',
  danger: '#e01e5a',
};

const attachmentColor = (color: string | undefined): string | null => {
  if (!color) {
    return null;
  }

  const named = NAMED_COLORS[color];

  if (named) {
    return named;
  }

  // Only a hex colour: the value ends up in a style attribute.
  return /^#?[0-9a-f]{3,8}$/i.test(color) ? `#${color.replace(/^#/, '')}` : null;
};

/** Attachments as the dashboard draws them; empty ones (only buttons) are dropped. */
export const attachmentViews = (event: SlackMessageEvent): SlackAttachmentView[] =>
  (event.attachments ?? [])
    .map((attachment) => {
      const fields = (attachment.fields ?? [])
        .map((field) => ({ title: field.title ?? '', value: field.value ?? '' }))
        .filter((field) => field.title !== '' || field.value !== '');
      const links = (attachment.actions ?? [])
        .filter((action) => /^https?:\/\//.test(action.url ?? '') && action.text)
        .map((action) => ({ text: action.text ?? '', url: action.url ?? '' }));
      // Buttons count as content: then `fallback` ("[no preview available]") is noise.
      const hasContent =
        Boolean(attachment.text ?? attachment.title ?? attachment.pretext) ||
        fields.length > 0 ||
        (attachment.actions ?? []).length > 0;

      return {
        color: attachmentColor(attachment.color),
        pretext: attachment.pretext ?? '',
        author: attachment.author_name ?? '',
        title: attachment.title ?? '',
        titleLink: /^https?:\/\//.test(attachment.title_link ?? '')
          ? (attachment.title_link ?? null)
          : null,
        // `fallback` is the plain summary; use it only when nothing else is there.
        text: attachment.text ?? (hasContent ? '' : (attachment.fallback ?? '')),
        fields,
        footer: attachment.footer ?? '',
        links,
      };
    })
    .filter(
      (view) =>
        view.text !== '' ||
        view.title !== '' ||
        view.pretext !== '' ||
        view.fields.length > 0 ||
        view.links.length > 0
    );

const DISPLAY_BLOCKS = new Set(['section', 'header', 'context']);

/**
 * What an app's Block Kit message says, as mrkdwn. Slack shows blocks instead of
 * `text` (then only the notification fallback); `rich_text` blocks just repeat the
 * text, so a message with only those keeps its text (null).
 */
export const blocksText = (blocks: SlackMessageEvent['blocks']): string | null => {
  const shown = (blocks ?? []).filter((block) => DISPLAY_BLOCKS.has(block.type));

  if (shown.length === 0) {
    return null;
  }

  return shown
    .map((block) => {
      if (block.type === 'header') {
        return `*${block.text?.text ?? ''}*`;
      }

      if (block.type === 'context') {
        return (block.elements ?? [])
          .map((element) => element.text ?? '')
          .filter((text) => text !== '')
          .join(' · ');
      }

      return [block.text?.text ?? '', ...(block.fields ?? []).map((field) => field.text)]
        .filter((text) => text !== '')
        .join('\n');
    })
    .filter((text) => text !== '')
    .join('\n');
};

/** Every piece of mrkdwn an attachment shows, in reading order. */
export const attachmentTexts = (view: SlackAttachmentView): string[] =>
  [
    view.pretext,
    view.author,
    view.title,
    view.text,
    ...view.fields.map((field) => (field.title ? `${field.title}: ${field.value}` : field.value)),
    view.footer,
    ...view.links.map((link) => link.text),
  ].filter((text) => text !== '');

/**
 * Items Slack's read markers show as read. The marker covers a conversation's main
 * timeline only: thread replies have their own read state, which Slack does not give
 * apps, so they are never closed this way.
 */
export const readItemIds = (
  open: readonly { readonly externalId: string; readonly threadKey: string }[],
  lastRead: ReadonlyMap<string, string | null>
): string[] =>
  open
    .filter(({ externalId, threadKey }) => {
      const [channel = '', ts = ''] = externalId.split(':');
      const marker = lastRead.get(channel);
      const mainTimeline = threadKey === channel || threadKey === externalId;

      return mainTimeline && Boolean(marker) && Number(ts) <= Number(marker);
    })
    .map(({ externalId }) => externalId);

/** The conversations to ask Slack about: those with waiting top-level messages. */
export const channelsToCheck = (
  open: readonly { readonly externalId: string; readonly threadKey: string }[],
  max: number
): string[] =>
  [
    ...new Set(
      open
        .filter(({ externalId, threadKey }) => {
          const channel = externalId.split(':')[0] ?? '';

          return threadKey === channel || threadKey === externalId;
        })
        .map(({ externalId }) => externalId.split(':')[0] ?? '')
    ),
  ].slice(0, max);
