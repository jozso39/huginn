import type { proto } from 'baileys';

/** "[photo] the caption": media as a note, with its text when it has some. */
const note = (label: string, detail?: string | null): string =>
  [`[${label}]`, detail?.trim()].filter((part): part is string => Boolean(part)).join(' ');

/**
 * What a message shows as text, and whether it carries media; null for what is not a
 * message worth showing (reactions, receipts, key exchanges, polls being voted on).
 * `content` is already unwrapped (disappearing, view-once and edit wrappers).
 */
export const messageText = (
  content: proto.IMessage | null | undefined
): { readonly text: string; readonly hasMedia: boolean } | null => {
  if (!content) {
    return null;
  }

  const plain = content.conversation ?? content.extendedTextMessage?.text;

  if (plain) {
    return { text: plain, hasMedia: false };
  }

  const media: [string, string | null | undefined] | null = content.imageMessage
    ? ['photo', content.imageMessage.caption]
    : content.videoMessage
      ? [content.videoMessage.gifPlayback ? 'GIF' : 'video', content.videoMessage.caption]
      : content.audioMessage
        ? [content.audioMessage.ptt ? 'voice message' : 'audio', null]
        : content.documentMessage
          ? ['file', content.documentMessage.caption ?? content.documentMessage.fileName]
          : content.stickerMessage
            ? ['sticker', null]
            : null;

  if (media) {
    return { text: note(...media), hasMedia: true };
  }

  const poll =
    content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3;
  const other: [string, string | null | undefined] | null = content.locationMessage
    ? ['location', content.locationMessage.name ?? content.locationMessage.address]
    : content.liveLocationMessage
      ? ['live location', content.liveLocationMessage.caption]
      : content.contactMessage
        ? ['contact', content.contactMessage.displayName]
        : content.contactsArrayMessage
          ? ['contacts', content.contactsArrayMessage.displayName]
          : poll
            ? ['poll', poll.name]
            : content.eventMessage
              ? ['event', content.eventMessage.name]
              : null;

  return other ? { text: note(...other), hasMedia: false } : null;
};

/** Who a message mentions and what it quotes, wherever the message type keeps it. */
export const contextOf = (content: proto.IMessage | null | undefined): proto.IContextInfo | null =>
  content?.extendedTextMessage?.contextInfo ??
  content?.imageMessage?.contextInfo ??
  content?.videoMessage?.contextInfo ??
  content?.audioMessage?.contextInfo ??
  content?.documentMessage?.contextInfo ??
  content?.stickerMessage?.contextInfo ??
  content?.locationMessage?.contextInfo ??
  content?.contactMessage?.contextInfo ??
  null;

/** WhatsApp writes a mention as @ and the person's number (or hidden id): show the name. */
export const withNames = (
  text: string,
  mentions: readonly { readonly user: string; readonly name: string }[]
): string =>
  mentions.reduce((result, { user, name }) => result.replaceAll(`@${user}`, `@${name}`), text);

/** `420600000001@s.whatsapp.net` → `+420600000001`; ids that hide the number → null. */
export const phoneOf = (jid: string | null | undefined): string | null => {
  const match = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid ?? '');

  return match?.[1] ? `+${match[1]}` : null;
};
