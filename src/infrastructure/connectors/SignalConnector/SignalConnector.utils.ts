import type {
  SignalDataMessage,
  SignalEnvelope,
  SignalMention,
  SignalReadMessage,
  SignalTarget,
} from '@/core/clients/SignalClient/SignalClient.types';
import type { NewItem } from '@/core/items/Item.types';
import { ItemKind } from '@/core/items/Item.types';
import type { SignalItemRaw } from './SignalConnector.types';

/** Signal puts U+FFFC where a mention sits; the mention list says who it is. */
const MENTION_MARK = '￼';

export const signalMessageId = (author: string, timestamp: number): string =>
  `${timestamp}:${author}`;

export const conversationKey = (target: SignalTarget): string =>
  'groupId' in target ? `group:${target.groupId}` : `dm:${target.recipient}`;

export const envelopeAuthor = (envelope: SignalEnvelope): string =>
  envelope.sourceUuid ?? envelope.sourceNumber ?? envelope.source ?? 'unknown';

/** Replaces each mention mark with @Name, right to left so offsets stay valid. */
export const withMentions = (text: string, mentions: readonly SignalMention[] = []): string =>
  [...mentions]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, mention) =>
        result.slice(0, mention.start) +
        `@${mention.name ?? mention.number ?? 'someone'}` +
        result.slice(mention.start + mention.length),
      text
    )
    .replaceAll(MENTION_MARK, '@someone');

const attachmentNote = (message: SignalDataMessage): string => {
  if (message.sticker) {
    return '[sticker]';
  }

  const attachments = message.attachments ?? [];

  if (attachments.length === 0) {
    return '';
  }

  const types = attachments.map((a) => (a.contentType ?? 'file').split('/')[0] ?? 'file');

  return `[${attachments.length === 1 ? types[0] : `${attachments.length} attachments`}]`;
};

/** Text worth an item: a message or an attachment. Reactions, deletes and group updates are not. */
export const messageText = (message: SignalDataMessage): string | null => {
  if (message.reaction || message.remoteDelete) {
    return null;
  }

  const text = withMentions(message.message ?? '', message.mentions).trim();
  const note = attachmentNote(message);
  const combined = [note, text].filter((part) => part !== '').join(' ');

  return combined === '' ? null : combined;
};

export const mentionsAccount = (
  mentions: readonly SignalMention[] | undefined,
  account: string,
  accountUuid: string | null
): boolean =>
  (mentions ?? []).some(
    (mention) =>
      mention.number === account || (accountUuid !== null && mention.uuid === accountUuid)
  );

export interface IncomingContext {
  readonly connectionId: string;
  readonly account: string;
  readonly accountUuid: string | null;
  readonly groupName: string | null;
  readonly maxBodyChars: number;
}

/**
 * One received message → one item. A 1:1 chat is a direct message; in a group it is
 * a mention when it names the account, otherwise a plain message.
 */
export const incomingToItem = (
  envelope: SignalEnvelope,
  message: SignalDataMessage,
  text: string,
  ctx: IncomingContext
): NewItem => {
  const author = envelopeAuthor(envelope);
  // An empty profile name counts as none.
  const name =
    [envelope.sourceName, envelope.sourceNumber].find((value): value is string => Boolean(value)) ??
    'Someone';
  const group = message.groupInfo;
  const target: SignalTarget = group
    ? { groupId: group.groupId }
    : // The uuid, not the number: people can hide their number, and both keys must match.
      { recipient: author };
  const isMention =
    Boolean(group) && mentionsAccount(message.mentions, ctx.account, ctx.accountUuid);
  const groupName = group?.groupName ?? ctx.groupName ?? 'a group';
  const raw: SignalItemRaw = { target, author, timestamp: message.timestamp, text };

  return {
    connectionId: ctx.connectionId,
    externalId: signalMessageId(author, message.timestamp),
    threadKey: conversationKey(target),
    kind: !group ? ItemKind.DirectMessage : isMention ? ItemKind.Mention : ItemKind.Message,
    author: name,
    title: group ? `${name} in ${groupName}` : `${name} in a direct message`,
    body: text.slice(0, ctx.maxBodyChars),
    url: null,
    receivedAt: new Date(message.timestamp),
    features: {
      isDm: !group,
      isGroup: Boolean(group),
      isMention,
      groupName: group ? groupName : null,
      fromNumber: envelope.sourceNumber ?? null,
      hasAttachment: (message.attachments ?? []).length > 0,
    },
    raw,
  };
};

/** Where a message the account sent from the phone went. */
export const sentTarget = (sent: {
  readonly groupInfo?: { readonly groupId: string };
  readonly destinationUuid?: string | null;
  readonly destinationNumber?: string | null;
  readonly destination?: string | null;
}): SignalTarget | null => {
  if (sent.groupInfo) {
    return { groupId: sent.groupInfo.groupId };
  }

  const recipient = sent.destinationUuid ?? sent.destinationNumber ?? sent.destination;

  return recipient ? { recipient } : null;
};

/** Read on the phone: the items for those messages are dealt with. */
export const readMessageIds = (reads: readonly SignalReadMessage[]): readonly string[] =>
  reads.flatMap((read) =>
    [read.senderUuid, read.senderNumber, read.sender]
      .filter((author): author is string => Boolean(author))
      .map((author) => signalMessageId(author, read.timestamp))
  );

/** The quick-reaction short names the dashboard offers, as the emoji Signal wants. */
export const EMOJI_BY_NAME: Readonly<Record<string, string>> = {
  thumbsup: '👍',
  '+1': '👍',
  white_check_mark: '✅',
  eyes: '👀',
  pray: '🙏',
  raised_hands: '🙌',
  joy: '😂',
  heart: '❤️',
  tada: '🎉',
};
