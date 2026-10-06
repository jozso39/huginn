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
export type ConnectorKind = 'GitLab' | 'Slack' | 'Gmail' | 'ClickUp' | 'LinkedIn' | 'Signal';
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
  /** The same place in the installed app (slack://…); preferred when present. */
  appUrl: string | null;
  rich: RichContent | null;
  status: ItemStatus | null;
  receivedAt: string;
  features: Record<string, string | number | boolean | null>;
  category: Category;
  decidedByRuleId: string | null;
  decision: TriageDecision | null;
  state: ItemState;
  stateChangedAt: string;
  createdAt: string;
}

export interface Action {
  id: string;
  itemId: string;
  type: 'Reply' | 'Draft' | 'React' | 'Done' | 'Archive' | 'Synced' | 'MarkSpam' | 'MarkImportant';
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
  /** Its category; null: none (the inbox shows it on its own). */
  groupId: string | null;
  /** '#rrggbb' its items are tinted with. */
  color: string;
  createdAt: string;
}

/** A category connections are shown under (a ConnectionGroup on the server). */
export interface ConnectionGroup {
  id: string;
  name: string;
  createdAt: string;
}

export type Theme = 'System' | 'Light' | 'Dark';

export type AiProvider = 'OpenRouter' | 'TypeSafe';

/** Which AI key is set: never the key itself. */
export interface AiKeyInfo {
  provider: AiProvider;
  /** Its last four characters. */
  hint: string;
  savedAt: string;
}

export interface Settings {
  theme: Theme;
  /** The emoji offered as one-click reactions, in order ("👍", "🫥"). */
  quickReactions: string[];
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
  /** Huginn extension: shown only while these other fields have these values. */
  shownWhen?: Record<string, string>;
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
  /** Created by linking a phone (scan a QR code). */
  pairing: boolean;
  /** Why it cannot be added on this Mac (signal-cli missing); null when it can. */
  unavailable: string | null;
  configSchema: { properties?: Record<string, JsonSchemaProperty>; required?: string[] };
  secretFields: SecretField[];
}

export type OAuthProvider = 'Google' | 'Slack';
export type RedirectMode = 'Direct' | 'Relay';

export interface OAuthAppView {
  provider: OAuthProvider;
  configured: boolean;
  clientId: string | null;
  redirectMode: RedirectMode;
  /** What to register with the provider for each mode; null when that mode cannot work. */
  redirectUris: Record<RedirectMode, string | null>;
  /** False for Slack: signing in with PKCE needs only the client ID. */
  needsSecret: boolean;
  /** Every redirect URI the provider app must list (Slack: one per port the app may use). */
  registerUris: string[];
}

export type HuginnEvent =
  | { type: 'ItemUpserted'; item: Item; created: boolean }
  | { type: 'ItemChanged'; item: Item }
  | { type: 'ConnectionChanged'; connection: Connection };

export type Verdict = 'Important' | 'Spam';
export type RuleKind = 'Hard' | 'Soft';
export type RuleStatus = 'Active' | 'Proposed' | 'Disabled';
export type RuleOrigin = 'Default' | 'User' | 'Feedback';
export type DecisionSource = 'Rule' | 'NoRule' | 'User' | 'ClassifierUnavailable' | 'NoAiKey';

export const CONDITION_OPS = [
  'Equals',
  'NotEquals',
  'Contains',
  'NotContains',
  'StartsWith',
  'EndsWith',
  'Matches',
  'In',
  'IsTrue',
  'IsFalse',
  'Exists',
  'GreaterThan',
  'LessThan',
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: string | number | boolean | string[];
}

export type Predicate =
  Condition | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate };

export interface TriageDecision {
  category: Category;
  source: DecisionSource;
  ruleId: string | null;
  ruleName: string | null;
  probabilities: Record<string, number>;
  decidedAt: string;
}

export interface RuleDraft {
  name: string;
  verdict: Verdict;
  kind: RuleKind;
  predicate?: Predicate | null;
  criterion?: string | null;
  threshold?: number;
}

export interface Rule extends RuleDraft {
  id: string;
  connectionId: string;
  threshold: number;
  priority: number;
  status: RuleStatus;
  origin: RuleOrigin;
  hits: number;
  lastHitAt: string | null;
  createdAt: string;
  updatedAt: string;
  description: string;
}

export interface RuleHistoryEntry {
  id: string;
  ruleId: string;
  change: 'Created' | 'Updated' | 'Approved' | 'Disabled' | 'Enabled' | 'Deleted';
  origin: RuleOrigin;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  itemId: string | null;
  checks: Record<string, unknown> | null;
  createdAt: string;
}

export interface DryRunResult {
  evaluated: number;
  hits: {
    itemId: string;
    title: string;
    author: string;
    currentCategory: Category;
    userDecided: boolean;
    probability: number | null;
  }[];
  conflicts: number;
}

export interface FieldInfo {
  field: string;
  samples: string[];
}

export interface FeedbackResult {
  item: Item;
  outcome: 'RuleCreated' | 'RuleUpdated' | 'Proposed' | 'ItemOnly';
  rule: Rule | null;
  message: string;
}

/** A Slack attachment (the coloured side-bar box); text fields are Slack mrkdwn. */
export interface SlackAttachmentView {
  color: string | null;
  pretext: string;
  author: string;
  title: string;
  titleLink: string | null;
  text: string;
  /**
   * An attachment built from Block Kit (ClickUp): its lines in order; `context` ones are
   * Slack's small grey lines. Missing on attachments stored before.
   */
  blocks?: { context: boolean; text: string }[];
  fields: { title: string; value: string }[];
  footer: string;
  /** Missing on attachments stored before link buttons were kept. */
  links?: { text: string; url: string }[];
}

export type RichContent =
  | {
      format: 'SlackMrkdwn';
      text: string;
      attachments?: SlackAttachmentView[];
      users: Record<string, string>;
      channels: Record<string, string>;
      groups: Record<string, string>;
    }
  | { format: 'Html'; html: string }
  | { format: 'Text'; text: string };

export type StatusTone = 'Success' | 'Info' | 'Danger' | 'Warning' | 'Neutral';

/** The state of what the item is about (an MR: Open / Merged / Closed). */
export interface ItemStatus {
  label: string;
  tone: StatusTone;
}

export type PairingState = 'Waiting' | 'Linked' | 'Failed';

export interface PairingStatus {
  state: PairingState;
  connection: Connection | null;
  /** Linked: whether the connection is new, or one linked again. */
  created: boolean;
  error: string | null;
}

export type SignInState = 'Waiting' | 'Done' | 'Failed';

export interface SignInStart {
  /** The provider's page; in the Mac app it opens in the browser. */
  url: string;
  signInId: string;
}

export interface SignInStatus {
  state: SignInState;
  /** Done: a new connection, or the one that account already had. */
  connection: Connection | null;
  created: boolean;
  error: string | null;
}
