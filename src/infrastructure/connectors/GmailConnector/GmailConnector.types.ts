/** Which Gmail inbox tabs come in. Accounts without tabs (most Workspace ones) get everything. */
export enum GmailInboxScope {
  PrimaryOnly = 'PrimaryOnly',
  NoPromotions = 'NoPromotions',
  AllInbox = 'AllInbox',
}

export interface MailAddress {
  readonly name: string;
  readonly address: string;
}

/**
 * The part of a message kept on the item: enough to reply in-thread without
 * fetching it again, small enough not to store every newsletter's HTML.
 */
export interface GmailItemRaw {
  readonly id: string;
  readonly threadId: string;
  readonly mailbox: string;
  readonly from: MailAddress;
  readonly replyTo: readonly MailAddress[];
  readonly subject: string;
  readonly messageId: string;
  readonly references: string;
  readonly labelIds: readonly string[];
}
