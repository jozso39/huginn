import type { MessengerMessage } from '@/core/clients/MessengerClient/MessengerClient.types';
import type { NewItem } from '@/core/items/Item.types';
import { ItemKind } from '@/core/items/Item.types';
import type { MessengerItemRaw } from './MessengerConnector.types';

/** One thread per chat. */
export const threadKeyOf = (threadId: string): string => `thread:${threadId}`;

export interface IncomingContext {
  readonly connectionId: string;
  readonly maxBodyChars: number;
}

/** One received message → one item: a direct message, or a message in a group. */
export const incomingToItem = (message: MessengerMessage, ctx: IncomingContext): NewItem => {
  const name = message.senderName ?? 'Someone';
  const group = message.threadName ?? 'a group';
  const raw: MessengerItemRaw = {
    threadId: message.threadId,
    id: message.id,
    senderId: message.senderId,
    encrypted: message.encrypted,
  };

  return {
    connectionId: ctx.connectionId,
    externalId: message.id,
    threadKey: threadKeyOf(message.threadId),
    kind: message.isGroup ? ItemKind.Message : ItemKind.DirectMessage,
    author: name,
    title: message.isGroup ? `${name} in ${group}` : `${name} in a direct message`,
    body: message.text.slice(0, ctx.maxBodyChars),
    url: message.url,
    appUrl: null,
    receivedAt: message.sentAt,
    features: {
      isDm: !message.isGroup,
      isGroup: message.isGroup,
      groupName: message.isGroup ? group : null,
      isEncrypted: message.encrypted,
    },
    raw,
  };
};
