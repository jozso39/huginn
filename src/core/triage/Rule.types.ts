import type { Category } from '@/core/items/Item.types';

/** What a rule decides. Undecided is not a verdict: it is what happens when nothing fires. */
export enum RuleVerdict {
  Important = 'Important',
  Spam = 'Spam',
}

export enum RuleKind {
  /** A predicate on the item's fields and features, evaluated in code. */
  Hard = 'Hard',
  /** A one-sentence criterion, asked of Jev as a yes/no question. */
  Soft = 'Soft',
}

export enum RuleStatus {
  Active = 'Active',
  /** Suggested by the feedback agent but not live until the user approves it. */
  Proposed = 'Proposed',
  Disabled = 'Disabled',
}

export enum RuleOrigin {
  /** Shipped with the connector (origin triage). */
  Default = 'Default',
  User = 'User',
  /** Written by the feedback agent from a Spam/Important click. */
  Feedback = 'Feedback',
}

export enum ConditionOp {
  Equals = 'Equals',
  NotEquals = 'NotEquals',
  Contains = 'Contains',
  NotContains = 'NotContains',
  StartsWith = 'StartsWith',
  EndsWith = 'EndsWith',
  Matches = 'Matches',
  In = 'In',
  IsTrue = 'IsTrue',
  IsFalse = 'IsFalse',
  Exists = 'Exists',
  GreaterThan = 'GreaterThan',
  LessThan = 'LessThan',
}

export interface Condition {
  /** A feature key, or one of the item fields: author, title, body, kind. */
  readonly field: string;
  readonly op: ConditionOp;
  readonly value?: string | number | boolean | readonly string[];
}

/** A small boolean language: conditions combined with all / any / not. */
export type Predicate =
  | Condition
  | { readonly all: readonly Predicate[] }
  | { readonly any: readonly Predicate[] }
  | { readonly not: Predicate };

export interface Rule {
  readonly id: string;
  readonly connectionId: string;
  readonly name: string;
  readonly verdict: RuleVerdict;
  readonly kind: RuleKind;
  readonly predicate: Predicate | null;
  readonly criterion: string | null;
  /** Soft rules fire at or above this Jev probability. */
  readonly threshold: number;
  /** Lower runs first; the first rule that fires decides. */
  readonly priority: number;
  readonly status: RuleStatus;
  readonly origin: RuleOrigin;
  readonly hits: number;
  readonly lastHitAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What someone (user, default set, agent) writes; the store fills in the rest. */
export interface RuleDraft {
  readonly name: string;
  readonly verdict: RuleVerdict;
  readonly kind: RuleKind;
  readonly predicate?: Predicate | null;
  readonly criterion?: string | null;
  readonly threshold?: number;
}

export enum DecisionSource {
  Rule = 'Rule',
  /** No rule fired. */
  NoRule = 'NoRule',
  /** The user moved it by hand (Spam / Important). */
  User = 'User',
  /** Jev could not be reached; soft rules were skipped. */
  ClassifierUnavailable = 'ClassifierUnavailable',
  /** No AI key is set, so sentence rules were not asked (Settings → AI triage). */
  NoAiKey = 'NoAiKey',
}

/** Why an item is where it is. Stored on the item; the dashboard's "why?". */
export interface TriageDecision {
  readonly category: Category;
  readonly source: DecisionSource;
  readonly ruleId: string | null;
  readonly ruleName: string | null;
  /** Jev probability per soft rule id, when soft rules ran. */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly decidedAt: string;
}

export enum RuleChange {
  Created = 'Created',
  Updated = 'Updated',
  Approved = 'Approved',
  Disabled = 'Disabled',
  Enabled = 'Enabled',
  Deleted = 'Deleted',
}

export interface RuleHistoryEntry {
  readonly id: string;
  readonly ruleId: string;
  readonly connectionId: string;
  readonly change: RuleChange;
  readonly origin: RuleOrigin;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  /** The user's explanation when the change came from feedback. */
  readonly reason: string | null;
  readonly itemId: string | null;
  /** Guardrail scores and dry-run numbers that let the change through. */
  readonly checks: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Date;
}
