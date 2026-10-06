import type {
  SlackAttachment,
  SlackBlock,
  SlackBlockElement,
  SlackChannelInfo,
  SlackMessageEvent,
  SlackSearchMatch,
  SlackTextStyle,
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
  /** Channels the user is in: search also finds public channels they never joined. */
  readonly myChannels: ReadonlySet<string>;
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
      ? ctx.myChannels.has(event.channel) && !ctx.ignoredChannels.has(event.channel)
      : ctx.watchedChannels.has(event.channel);

  return channelWanted ? SlackRelevance.ChannelMessage : SlackRelevance.Ignore;
};

/** A thread reply's permalink names its thread: `…/p1700000000123456?thread_ts=1700000000.000100`. */
export const threadTsOf = (permalink: string | undefined): string | null => {
  try {
    return permalink ? new URL(permalink).searchParams.get('thread_ts') : null;
  } catch {
    return null;
  }
};

const channelTypeOf = (channel: SlackSearchMatch['channel']): SlackMessageEvent['channel_type'] => {
  // DM channel IDs start with D; search does not always say is_im.
  if (channel.is_im || channel.id.startsWith('D')) {
    return 'im';
  }

  if (channel.is_mpim) {
    return 'mpim';
  }

  return channel.is_private ? 'group' : 'channel';
};

/** A search result as the message event everything else reads (blocks and attachments too). */
export const eventFromMatch = (match: SlackSearchMatch): SlackMessageEvent => {
  const threadTs = threadTsOf(match.permalink);

  return {
    ...(match as object),
    type: 'message',
    channel: match.channel.id,
    channel_type: channelTypeOf(match.channel),
    user: match.user,
    username: match.username,
    text: match.text,
    ts: match.ts,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  };
};

/**
 * What to search for to see everything since `sinceTs` (seconds). Slack's `after:` takes a
 * day in the user's time zone, so it asks from two days earlier; the cursor does the rest.
 */
export const searchSince = (sinceTs: number): string =>
  `after:${new Date((sinceTs - 2 * 86_400) * 1000).toISOString().slice(0, 10)}`;

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

/**
 * The same message in the Slack app. `message` (and `thread_ts` for a reply) is what
 * Slack's own clients use; without them the app still opens the conversation.
 */
export const appLink = (teamId: string, event: SlackMessageEvent): string => {
  const params = new URLSearchParams({ team: teamId, id: event.channel, message: event.ts });

  if (event.thread_ts && event.thread_ts !== event.ts) {
    params.set('thread_ts', event.thread_ts);
  }

  return `slack://channel?${params.toString()}`;
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

const isWebLink = (url: string | undefined): url is string => /^https?:\/\//.test(url ?? '');

/** A context line's text, or a button's label (an object there). */
const elementText = (element: SlackBlockElement): string =>
  typeof element.text === 'string' ? element.text : (element.text?.text ?? '');

interface BlockLine {
  readonly context: boolean;
  readonly text: string;
}

// Innermost first, as Slack nests them: *_~`x`~_*.
const STYLE_MARKS: readonly (readonly [keyof SlackTextStyle, string])[] = [
  ['code', '`'],
  ['strike', '~'],
  ['italic', '_'],
  ['bold', '*'],
];

/** Marks around the words only: mrkdwn ignores `*bold *`, so spaces stay outside. */
const styled = (text: string, style: SlackBlockElement['style']): string => {
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];

  if (core === '' || typeof style !== 'object') {
    return text;
  }

  const marked = STYLE_MARKS.reduce(
    (inner, [key, mark]) => (style[key] ? `${mark}${inner}${mark}` : inner),
    core
  );

  return `${lead}${marked}${trail}`;
};

/** One inline piece of `rich_text` as mrkdwn, the way Slack writes the message's text. */
const inlineMrkdwn = (element: SlackBlockElement): string => {
  const text = typeof element.text === 'string' ? element.text : '';

  switch (element.type) {
    case 'text':
      return styled(text, element.style);
    case 'link':
      return styled(text ? `<${element.url}|${text}>` : `<${element.url}>`, element.style);
    case 'user':
      return `<@${element.user_id}>`;
    case 'usergroup':
      return `<!subteam^${element.usergroup_id}>`;
    case 'channel':
      return `<#${element.channel_id}>`;
    case 'emoji':
      return `:${element.name}:`;
    case 'broadcast':
      return `<!${element.range}>`;
    default:
      return element.fallback ?? text;
  }
};

/** A `rich_text` container (section, list, quote, code block) as mrkdwn lines. */
const containerMrkdwn = (container: SlackBlockElement): string => {
  const inline = (container.elements ?? []).map(inlineMrkdwn).join('');

  switch (container.type) {
    case 'rich_text_list': {
      const indent = '    '.repeat(container.indent ?? 0);

      return (container.elements ?? [])
        .map(
          (item, index) =>
            `${indent}${container.style === 'ordered' ? `${index + 1}.` : '•'} ${containerMrkdwn(item)}`
        )
        .join('\n');
    }

    case 'rich_text_quote':
      return inline
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'rich_text_preformatted':
      return `\`\`\`\n${inline}\n\`\`\``;
    default:
      return inline;
  }
};

/** A `rich_text` block (or table cell) as mrkdwn: what Slack would put in `text`. */
export const richTextMrkdwn = (block: {
  readonly elements?: readonly SlackBlockElement[];
}): string =>
  (block.elements ?? [])
    .map((container) => containerMrkdwn(container).replace(/\n+$/, ''))
    .filter((part) => part !== '')
    .join('\n');

const cellMrkdwn = (cell: SlackBlockElement): string =>
  (cell.type === 'rich_text'
    ? richTextMrkdwn(cell)
    : typeof cell.text === 'string'
      ? cell.text
      : ''
  )
    .replace(/\s*\n\s*/g, ' ')
    .trim();

/** A table as one line per row, cells set apart by bars; the first row is the header. */
const tableMrkdwn = (block: SlackBlock): string =>
  (block.rows ?? [])
    .map((row, index) =>
      row
        .map(cellMrkdwn)
        .map((cell) => (index === 0 && (block.rows ?? []).length > 1 && cell ? `*${cell}*` : cell))
        .join(' | ')
    )
    .filter((line) => line.replace(/[\s|]/g, '') !== '')
    .join('\n');

/**
 * One block as a line of mrkdwn, or null for what is not text (images, buttons, and
 * `rich_text`, which is the message's own text: see `blocksText`).
 */
const blockLine = (block: SlackBlock): BlockLine | null => {
  const text =
    block.type === 'header'
      ? block.text?.text
        ? `*${block.text.text}*`
        : ''
      : block.type === 'context'
        ? (block.elements ?? [])
            .map(elementText)
            .filter((part) => part !== '')
            .join(' · ')
        : block.type === 'section'
          ? [block.text?.text ?? '', ...(block.fields ?? []).map((field) => field.text)]
              .filter((part) => part !== '')
              .join('\n')
          : block.type === 'table'
            ? tableMrkdwn(block)
            : '';

  return text === '' ? null : { context: block.type === 'context', text };
};

/** Buttons that open a page ("View comment"); those that only call the app are left out. */
const blockLinks = (block: SlackBlock): { text: string; url: string }[] =>
  [
    ...(block.type === 'actions' ? (block.elements ?? []) : []),
    ...(block.accessory ? [block.accessory] : []),
  ]
    .filter((element) => element.type === 'button' && isWebLink(element.url))
    .map((element) => ({ text: elementText(element), url: element.url ?? '' }))
    .filter((link) => link.text !== '');

/**
 * An attachment's Block Kit as lines, in Slack's order, when it shows more than the
 * attachment's own text: its `rich_text` block is that text, so a shared message keeps it
 * and gains the lines around it ("Sent using …"). Empty when the blocks add nothing.
 */
const attachmentLines = (attachment: SlackAttachment): BlockLine[] => {
  const blocks = attachment.blocks ?? [];

  if (!blocks.some((block) => blockLine(block) !== null)) {
    return [];
  }

  const textAt = blocks.findIndex((block) => block.type === 'rich_text');

  return blocks.flatMap((block, index) => {
    if (index === textAt) {
      return attachment.text ? [{ context: false, text: attachment.text }] : [];
    }

    const line = blockLine(block);

    return line ? [line] : [];
  });
};

/** Attachments as the dashboard draws them; empty ones (only buttons) are dropped. */
export const attachmentViews = (event: SlackMessageEvent): SlackAttachmentView[] =>
  (event.attachments ?? [])
    .map((attachment) => {
      const fields = (attachment.fields ?? [])
        .map((field) => ({ title: field.title ?? '', value: field.value ?? '' }))
        .filter((field) => field.title !== '' || field.value !== '');
      const blocks = attachmentLines(attachment);
      const links = [
        ...(attachment.actions ?? [])
          .filter((action) => isWebLink(action.url) && action.text)
          .map((action) => ({ text: action.text ?? '', url: action.url ?? '' })),
        ...(attachment.blocks ?? []).flatMap(blockLinks),
      ];
      // Buttons count as content: then `fallback` ("[no preview available]") is noise.
      const hasContent =
        Boolean(attachment.text ?? attachment.title ?? attachment.pretext) ||
        fields.length > 0 ||
        blocks.length > 0 ||
        (attachment.actions ?? []).length > 0 ||
        (attachment.blocks ?? []).some((block) => block.type === 'actions');

      return {
        color: attachmentColor(attachment.color),
        pretext: attachment.pretext ?? '',
        author: attachment.author_name ?? '',
        title: attachment.title ?? '',
        titleLink: isWebLink(attachment.title_link) ? attachment.title_link : null,
        // Blocks that say something replace the text, as in Slack. `fallback` is the
        // plain summary; use it only when nothing else is there.
        text:
          blocks.length > 0
            ? ''
            : (attachment.text ?? (hasContent ? '' : (attachment.fallback ?? ''))),
        blocks,
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
        view.blocks.length > 0 ||
        view.fields.length > 0 ||
        view.links.length > 0
    );

/**
 * What a Block Kit message says, as mrkdwn, in Slack's order. Slack shows blocks instead
 * of `text` (then only the notification fallback). A `rich_text` block is the message's
 * own words, so the first one is `text` and keeps its place among the other blocks (a
 * table, "Sent using …"); a message with nothing but `rich_text` keeps its text (null).
 */
export const blocksText = (blocks: SlackMessageEvent['blocks'], text?: string): string | null => {
  const all = blocks ?? [];

  if (!all.some((block) => blockLine(block) !== null)) {
    return null;
  }

  const textAt = all.findIndex((block) => block.type === 'rich_text');

  return all
    .map((block, index) =>
      block.type === 'rich_text'
        ? index === textAt && text
          ? text.replace(/\s+$/, '')
          : richTextMrkdwn(block)
        : (blockLine(block)?.text ?? '')
    )
    .filter((part) => part !== '')
    .join('\n');
};

/** Every piece of mrkdwn an attachment shows, in reading order. */
export const attachmentTexts = (view: SlackAttachmentView): string[] =>
  [
    view.pretext,
    view.author,
    view.title,
    view.text,
    ...(view.blocks ?? []).map((line) => line.text),
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
