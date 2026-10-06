export enum ConnectorKind {
  GitLab = 'GitLab',
  Slack = 'Slack',
  Gmail = 'Gmail',
  ClickUp = 'ClickUp',
  /** LinkedIn's notification mails, read from a Gmail mailbox (LinkedIn has no API). */
  LinkedIn = 'LinkedIn',
  /** The user's own Signal account, as a linked device of their phone. */
  Signal = 'Signal',
  /** No poller: items arrive through POST /api/items (Hermes, scripts). */
  Ingest = 'Ingest',
}

export enum ConnectionStatus {
  Idle = 'Idle',
  Running = 'Running',
  /** Waiting for the user to sign in (OAuth) before it can start. */
  NeedsAuth = 'NeedsAuth',
  Error = 'Error',
  Disabled = 'Disabled',
}

/** Per-connection, connector-defined settings that are safe to show and log. */
export type ConnectionConfig = Readonly<Record<string, unknown>>;

/** Where the connector left off (last todo id, Slack ts, Gmail historyId). */
export type ConnectionCursor = Readonly<Record<string, unknown>>;

export interface Connection {
  readonly id: string;
  readonly kind: ConnectorKind;
  /** "Work Slack", "Personal Gmail" — two rows of one kind are two connections. */
  readonly name: string;
  readonly config: ConnectionConfig;
  readonly cursor: ConnectionCursor;
  readonly enabled: boolean;
  readonly status: ConnectionStatus;
  readonly statusMessage: string | null;
  readonly lastSyncAt: Date | null;
  /** Its category (a ConnectionGroup); null: none, the inbox shows it on its own. */
  readonly groupId: string | null;
  /** '#rrggbb' its items are tinted with (Connection.utils.ts). */
  readonly color: string;
  readonly createdAt: Date;
}

export type Secrets = Readonly<Record<string, string>>;

export interface NewConnection {
  readonly kind: ConnectorKind;
  readonly name: string;
  readonly config: ConnectionConfig;
  readonly secrets: Secrets;
  readonly groupId?: string | null;
  /** Left out: the first palette colour no other connection has. */
  readonly color?: string;
}

/** What the settings form changes. Only a new config restarts the connector. */
export interface ConnectionChanges {
  readonly name: string;
  readonly config: ConnectionConfig;
  readonly groupId?: string | null;
  readonly color?: string;
}

export interface ConnectionPatch {
  readonly name?: string;
  readonly config?: ConnectionConfig;
  readonly cursor?: ConnectionCursor;
  readonly enabled?: boolean;
  readonly status?: ConnectionStatus;
  readonly statusMessage?: string | null;
  readonly lastSyncAt?: Date | null;
  readonly groupId?: string | null;
  readonly color?: string;
}
