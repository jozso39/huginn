/** A MIME part as the Gmail API returns it (`format=full`). Header values are decoded. */
export interface GmailPart {
  readonly mimeType: string;
  readonly filename?: string;
  readonly headers?: readonly { readonly name: string; readonly value: string }[];
  readonly body?: {
    readonly data?: string;
    readonly size?: number;
    readonly attachmentId?: string;
  };
  readonly parts?: readonly GmailPart[];
}

export interface GmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds?: readonly string[];
  /** Epoch milliseconds, as a string. */
  readonly internalDate: string;
  readonly snippet?: string;
  readonly payload: GmailPart;
}

export interface GmailMessageRef {
  readonly id: string;
  readonly threadId: string;
  readonly labelIds?: readonly string[];
}

export interface GmailHistoryRecord {
  readonly messagesAdded?: readonly { readonly message: GmailMessageRef }[];
  readonly labelsAdded?: readonly {
    readonly message: GmailMessageRef;
    readonly labelIds: readonly string[];
  }[];
  readonly labelsRemoved?: readonly {
    readonly message: GmailMessageRef;
    readonly labelIds: readonly string[];
  }[];
}

export interface GmailHistory {
  readonly records: readonly GmailHistoryRecord[];
  /** Where the next poll starts. */
  readonly historyId: string;
}

export interface GmailProfile {
  readonly emailAddress: string;
  readonly historyId: string;
}

/** One mailbox, acting as its owner. */
export interface IGmailClient {
  profile(): Promise<GmailProfile>;
  searchMessageIds(query: string, max: number): Promise<readonly string[]>;
  getMessage(id: string): Promise<GmailMessage>;
  /** Changes since `startHistoryId`, or null when it is too old and a resync is needed. */
  history(startHistoryId: string): Promise<GmailHistory | null>;
  /** `raw` is a complete RFC 2822 message, base64url-encoded. */
  send(raw: string, threadId: string): Promise<GmailMessageRef>;
  createDraft(raw: string, threadId: string): Promise<{ readonly id: string }>;
  markRead(id: string): Promise<void>;
}
