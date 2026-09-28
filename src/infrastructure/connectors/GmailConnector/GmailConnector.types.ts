/** Which Gmail inbox tabs come in. Accounts without tabs (most Workspace ones) get everything. */
export enum GmailInboxScope {
  PrimaryOnly = 'PrimaryOnly',
  NoPromotions = 'NoPromotions',
  AllInbox = 'AllInbox',
}

/** The kind of OAuth client the user pasted; it decides where Google sends them back. */
export enum GoogleClientType {
  /** "Desktop app": back to http://localhost, the user pastes the address into Huginn. */
  Desktop = 'Desktop',
  /** "Web application": straight back to Huginn; needs HUGINN_PUBLIC_URL. */
  Web = 'Web',
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
