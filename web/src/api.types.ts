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
  /** Inbox group; null means the connection is its own group. */
  groupName: string | null;
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

export type Verdict = 'Important' | 'Spam';
export type RuleKind = 'Hard' | 'Soft';
export type RuleStatus = 'Active' | 'Proposed' | 'Disabled';
export type RuleOrigin = 'Default' | 'User' | 'Feedback';
export type DecisionSource = 'Rule' | 'NoRule' | 'User' | 'ClassifierUnavailable';

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

export type RichContent =
  | {
      format: 'SlackMrkdwn';
      text: string;
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
