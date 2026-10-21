/**
 * Facebook Messenger as Huginn sees it: the client (a helper built on mautrix-meta's
 * messagix, in infrastructure) turns the protocol into these shapes.
 */
import type { SessionCookies } from '@/core/login/LoginWindow.types';

export interface MessengerMessage {
  readonly id: string;
  /** The chat: stable, and different for an encrypted chat and an older plain one. */
  readonly threadId: string;
  readonly encrypted: boolean;
  readonly isGroup: boolean;
  readonly threadName: string | null;
  readonly senderId: string;
  readonly senderName: string | null;
  /** The account wrote it, from the phone or anywhere else. */
  readonly fromMe: boolean;
  /** The text; media as a note like "[photo]". */
  readonly text: string;
  readonly sentAt: Date;
  readonly replyToId: string | null;
  /** Opens the chat on facebook.com. */
  readonly url: string;
  /** Found unread when connecting, rather than arriving while connected. */
  readonly initial: boolean;
}

export enum MessengerEventType {
  Message = 'Message',
  /** The account read this chat elsewhere, up to `readAt`. */
  Read = 'Read',
  /** The session's cookies changed; store these to come back as the same session. */
  Cookies = 'Cookies',
  Connected = 'Connected',
  Disconnected = 'Disconnected',
  /** Facebook ended the session: only signing in again helps. */
  LoggedOut = 'LoggedOut',
}

export type MessengerEvent =
  | { readonly type: MessengerEventType.Message; readonly message: MessengerMessage }
  | { readonly type: MessengerEventType.Read; readonly threadId: string; readonly readAt: Date }
  | { readonly type: MessengerEventType.Cookies; readonly cookies: SessionCookies }
  | { readonly type: MessengerEventType.Connected }
  | { readonly type: MessengerEventType.Disconnected; readonly reason: string }
  | { readonly type: MessengerEventType.LoggedOut; readonly reason: string };

export type MessengerEventHandler = (event: MessengerEvent) => void;

export interface MessengerAccount {
  /** The Facebook user id. */
  readonly userId: string;
  readonly name: string | null;
}

/** One signed-in account, connected. Reconnects on its own until stopped or logged out. */
export interface IMessengerSession {
  /** Resolves once connected; rejects (Unauthorized) when the session is gone. */
  start(handler: MessengerEventHandler): Promise<MessengerAccount>;
  stop(): Promise<void>;
}

export interface IMessengerClient {
  /** Whether the helper program is there. */
  isAvailable(): boolean;
  /** The browser Facebook must see, in the login window too. */
  userAgent(): Promise<string>;
  /**
   * Checks freshly signed-in cookies and registers Huginn as a device of the account,
   * so encrypted chats reach it. Returns the account and the cookies to store.
   */
  login(cookies: SessionCookies): Promise<MessengerAccount & { readonly cookies: SessionCookies }>;
  session(cookies: SessionCookies): IMessengerSession;
  /** Stops every helper. Called at shutdown. */
  close(): Promise<void>;
}
