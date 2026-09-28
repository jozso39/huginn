export enum ConnectorKind {
  GitLab = 'GitLab',
  Slack = 'Slack',
  Gmail = 'Gmail',
  ClickUp = 'ClickUp',
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
  readonly createdAt: Date;
}

export type Secrets = Readonly<Record<string, string>>;

export interface NewConnection {
  readonly kind: ConnectorKind;
  readonly name: string;
  readonly config: ConnectionConfig;
  readonly secrets: Secrets;
}

export interface ConnectionPatch {
  readonly name?: string;
  readonly config?: ConnectionConfig;
  readonly cursor?: ConnectionCursor;
  readonly enabled?: boolean;
  readonly status?: ConnectionStatus;
  readonly statusMessage?: string | null;
  readonly lastSyncAt?: Date | null;
}
