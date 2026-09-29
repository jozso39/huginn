import type { GmailMessage } from '@/core/clients/GmailClient/GmailClient.types';
import type { ConnectorKind } from '@/core/connections/Connection.types';
import type { ConnectorCapabilities } from '@/core/connectors/Connector.types';
import type { NewItem } from '@/core/items/Item.types';

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

/**
 * What a Gmail-backed connection takes from the mailbox and how it shows it. The
 * Gmail connection is one; LinkedIn (its notification mails) is another.
 */
export interface MailSource {
  readonly kind: ConnectorKind;
  readonly capabilities: ConnectorCapabilities;
  /** Gmail search for the first sync. */
  backfillQuery(days: number): string;
  /** Checked against the message as it is now (labels change: read, archived). */
  accepts(message: GmailMessage): boolean;
  toItem(
    connectionId: string,
    message: GmailMessage,
    mailbox: string,
    maxBodyChars: number
  ): NewItem;
}
