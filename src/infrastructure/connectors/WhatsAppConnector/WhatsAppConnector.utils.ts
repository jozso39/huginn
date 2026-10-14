import type { WhatsAppMessage } from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import type { NewItem } from '@/core/items/Item.types';
import { ItemKind } from '@/core/items/Item.types';
import type { WhatsAppItemRaw } from './WhatsAppConnector.types';

/** One thread per chat: a person, or a group. */
export const chatKey = (chat: string): string => `chat:${chat}`;

export interface IncomingContext {
  readonly connectionId: string;
  readonly maxBodyChars: number;
}

/**
 * One received message → one item. A 1:1 chat is a direct message; in a group it is a
 * mention when it names the account or answers one of its messages, else a message.
 */
export const incomingToItem = (message: WhatsAppMessage, ctx: IncomingContext): NewItem => {
  const name = message.senderName;
  const group = message.groupName ?? 'a group';
  const forMe = message.mentionsMe || message.repliesToMe;
  // wa.me and whatsapp:// open a chat by number; groups have no such link.
  const number = !message.isGroup ? message.senderPhone?.replace(/\D/g, '') : undefined;
  const raw: WhatsAppItemRaw = {
    chat: message.chat,
    id: message.id,
    sender: message.sender,
    text: message.text,
  };

  return {
    connectionId: ctx.connectionId,
    externalId: message.id,
    threadKey: chatKey(message.chat),
    kind: !message.isGroup ? ItemKind.DirectMessage : forMe ? ItemKind.Mention : ItemKind.Message,
    author: name,
    title: message.isGroup ? `${name} in ${group}` : `${name} in a direct message`,
    body: message.text.slice(0, ctx.maxBodyChars),
    url: number ? `https://wa.me/${number}` : null,
    appUrl: number ? `whatsapp://send?phone=${number}` : null,
    receivedAt: message.sentAt,
    features: {
      isDm: !message.isGroup,
      isGroup: message.isGroup,
      isMention: message.mentionsMe,
      isReplyToMe: message.repliesToMe,
      groupName: message.isGroup ? group : null,
      fromNumber: message.senderPhone,
      hasMedia: message.hasMedia,
    },
    raw,
  };
};
