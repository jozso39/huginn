/**
 * WhatsApp as Huginn sees it: the client (Baileys, in infrastructure) turns the
 * protocol into these shapes, so nothing outside it knows Baileys' types.
 */

/** A message someone sent to the account, as text. */
export interface WhatsAppMessage {
  /** WhatsApp's id for the message; an edit keeps it. */
  readonly id: string;
  /** The chat it is in: a person's id, or a group's. */
  readonly chat: string;
  readonly isGroup: boolean;
  readonly groupName: string | null;
  /** Who wrote it: their id, what they are called, and their number when WhatsApp shows it. */
  readonly sender: string;
  readonly senderName: string;
  readonly senderPhone: string | null;
  /** The text, mentions as @Name; media as a note like "[photo]". */
  readonly text: string;
  readonly hasMedia: boolean;
  readonly mentionsMe: boolean;
  /** It quotes one of the account's own messages. */
  readonly repliesToMe: boolean;
  readonly sentAt: Date;
}

/** Enough of a message to answer it, react to it or mark it read. */
export interface WhatsAppMessageRef {
  readonly chat: string;
  readonly id: string;
  readonly sender: string;
  /** For a quote: what the answer is to. */
  readonly text: string;
}

export enum WhatsAppEventType {
  Message = 'Message',
  /** The account wrote in this chat from the phone (or anywhere else). */
  Sent = 'Sent',
  /** The account read these messages elsewhere. */
  Read = 'Read',
  Connected = 'Connected',
  /** The phone removed the linked device: only linking again helps. */
  LoggedOut = 'LoggedOut',
  /** The device's keys changed; `auth` is what to store to come back as the same device. */
  Auth = 'Auth',
}

export type WhatsAppEvent =
  | { readonly type: WhatsAppEventType.Message; readonly message: WhatsAppMessage }
  | { readonly type: WhatsAppEventType.Sent; readonly chat: string }
  | { readonly type: WhatsAppEventType.Read; readonly ids: readonly string[] }
  | { readonly type: WhatsAppEventType.Connected }
  | { readonly type: WhatsAppEventType.LoggedOut }
  | { readonly type: WhatsAppEventType.Auth; readonly auth: string };

export type WhatsAppEventHandler = (event: WhatsAppEvent) => void;

/** One linked account, connected. Reconnects on its own until stopped or logged out. */
export interface IWhatsAppSession {
  /** Resolves once connected; rejects when the phone has unlinked it, or it cannot connect. */
  start(handler: WhatsAppEventHandler): Promise<void>;
  stop(): Promise<void>;
  send(to: string, text: string, quote?: WhatsAppMessageRef): Promise<{ readonly id: string }>;
  react(target: WhatsAppMessageRef, emoji: string): Promise<void>;
  /** Read receipts, and the chat read on the phone too. */
  markRead(target: WhatsAppMessageRef): Promise<void>;
}

export interface WhatsAppLink {
  /** The phone number of the account. */
  readonly account: string;
  /** Its WhatsApp profile name, when it has one. */
  readonly name: string | null;
  /** The new device's keys (see the `auth` event). */
  readonly auth: string;
}

export interface IWhatsAppClient {
  /** A session for a linked account, from its stored keys. */
  session(auth: string): IWhatsAppSession;
  /** Starts linking a new device; returns the first code to show as a QR code. */
  startLink(): Promise<string>;
  /** WhatsApp replaces the code every 20 seconds or so: the one to show now. */
  currentLinkCode(code: string): string | null;
  /** "Link with phone number instead": the code to type on that phone. */
  linkWithPhone(code: string, phoneNumber: string): Promise<string>;
  /** Waits until the phone accepted the link started with `code`. */
  finishLink(code: string): Promise<WhatsAppLink>;
  /** Ends links still waiting. Called at shutdown. */
  close(): Promise<void>;
}
