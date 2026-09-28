// Wire shapes of the Huginn API. Kept in sync with src/core by hand: the web app
// is a client of the HTTP API and must never import server code.

export type ItemKind =
  | 'Message'
  | 'DirectMessage'
  | 'Mention'
  | 'Email'
  | 'Todo'
  | 'ReviewRequest'
  | 'Comment'
  | 'Assignment'
  | 'Alert';

export type ItemState = 'Open' | 'Done' | 'Archived';
export type Category = 'Important' | 'Undecided' | 'Spam';
export type ConnectorKind = 'GitLab' | 'Slack' | 'Gmail' | 'ClickUp' | 'Ingest';
export type ConnectionStatus = 'Idle' | 'Running' | 'NeedsAuth' | 'Error' | 'Disabled';

export interface Item {
  id: string;
  connectionId: string;
  externalId: string;
  threadKey: string;
  kind: ItemKind;
  author: string;
  title: string;
  body: string;
  url: string | null;
  receivedAt: string;
  features: Record<string, string | number | boolean | null>;
  category: Category;
  decidedByRuleId: string | null;
  state: ItemState;
  stateChangedAt: string;
  createdAt: string;
}

export interface Action {
  id: string;
  itemId: string;
  type: 'Reply' | 'Draft' | 'React' | 'Done' | 'Archive' | 'Synced';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
}

export interface Connection {
  id: string;
  kind: ConnectorKind;
  name: string;
  config: Record<string, unknown>;
  cursor: Record<string, unknown>;
  enabled: boolean;
  status: ConnectionStatus;
  statusMessage: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface SecretField {
  key: string;
  label: string;
  hint?: string;
}

export interface JsonSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  default?: unknown;
  /** A choice: rendered as a dropdown. */
  enum?: string[];
  /** Huginn extension: human labels for `enum` values. */
  optionLabels?: Record<string, string>;
}

export interface ConnectorCapabilities {
  reply: boolean;
  draft: boolean;
  react: boolean;
  ack: boolean;
}

export interface ConnectorDescriptor {
  kind: ConnectorKind;
  label: string;
  capabilities: ConnectorCapabilities;
  /** Set when connections of this kind are created by signing in, not by a form. */
  signInProvider: OAuthProvider | null;
  configSchema: { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
  secretFields: SecretField[];
}

export type OAuthProvider = 'Google';
export type RedirectMode = 'Direct' | 'Relay';

export interface OAuthAppView {
  provider: OAuthProvider;
  configured: boolean;
  clientId: string | null;
  redirectMode: RedirectMode;
  /** What to register with the provider for each mode; null when that mode cannot work. */
  redirectUris: Record<RedirectMode, string | null>;
}

export type HuginnEvent =
  | { type: 'ItemUpserted'; item: Item; created: boolean }
  | { type: 'ItemChanged'; item: Item }
  | { type: 'ConnectionChanged'; connection: Connection };
