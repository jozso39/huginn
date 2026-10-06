/**
 * The subset of signal-cli's JSON-RPC envelope Huginn reads. Field names follow
 * signal-cli; everything is optional because envelopes vary by what they carry.
 */
export interface SignalGroupInfo {
  readonly groupId: string;
  readonly groupName?: string;
}

export interface SignalMention {
  readonly number?: string | null;
  readonly uuid?: string | null;
  readonly name?: string | null;
  readonly start: number;
  readonly length: number;
}

export interface SignalAttachment {
  readonly contentType?: string;
  readonly filename?: string | null;
}

export interface SignalDataMessage {
  readonly timestamp: number;
  readonly message?: string | null;
  readonly groupInfo?: SignalGroupInfo;
  readonly mentions?: readonly SignalMention[];
  readonly attachments?: readonly SignalAttachment[];
  readonly sticker?: unknown;
  readonly reaction?: unknown;
  readonly remoteDelete?: unknown;
}

export interface SignalSentMessage extends SignalDataMessage {
  readonly destination?: string | null;
  readonly destinationNumber?: string | null;
  readonly destinationUuid?: string | null;
}

export interface SignalReadMessage {
  readonly sender?: string | null;
  readonly senderNumber?: string | null;
  readonly senderUuid?: string | null;
  readonly timestamp: number;
}

export interface SignalEnvelope {
  readonly source?: string | null;
  readonly sourceNumber?: string | null;
  readonly sourceUuid?: string | null;
  readonly sourceName?: string | null;
  readonly timestamp: number;
  readonly dataMessage?: SignalDataMessage;
  readonly editMessage?: {
    readonly targetSentTimestamp: number;
    readonly dataMessage: SignalDataMessage;
  };
  readonly syncMessage?: {
    readonly sentMessage?: SignalSentMessage;
    readonly readMessages?: readonly SignalReadMessage[];
  };
}

/** A 1:1 chat (number or uuid) or a group. */
export type SignalTarget = { readonly recipient: string } | { readonly groupId: string };

export type SignalEnvelopeHandler = (envelope: SignalEnvelope) => void;

export interface ISignalClient {
  /** Whether signal-cli is installed on this machine, so Signal can be offered at all. */
  isAvailable(): boolean;
  /** Accounts signal-cli has (linked ones). */
  accounts(): Promise<readonly string[]>;
  /** Delivers this account's envelopes to `handler` until `unsubscribe`. Reconnects on its own. */
  subscribe(account: string, handler: SignalEnvelopeHandler): Promise<void>;
  unsubscribe(account: string): void;
  send(
    account: string,
    target: SignalTarget,
    text: string,
    quote?: { readonly timestamp: number; readonly author: string; readonly text: string }
  ): Promise<{ readonly timestamp: number }>;
  react(
    account: string,
    target: SignalTarget,
    emoji: string,
    targetAuthor: string,
    targetTimestamp: number
  ): Promise<void>;
  /** Group names, cached; null when unknown. */
  groupName(account: string, groupId: string): Promise<string | null>;
  /** Starts linking a new device; returns the `sgnl://linkdevice…` URI to show as a QR code. */
  startLink(): Promise<string>;
  /** Waits until the phone scanned `uri`; returns the linked account's number. */
  finishLink(uri: string, deviceName: string): Promise<string>;
  close(): Promise<void>;
}
