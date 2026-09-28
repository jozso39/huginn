import type { Rule, RuleDraft, RuleHistoryEntry, RuleOrigin, RuleStatus } from './Rule.types';

export interface NewRule extends RuleDraft {
  readonly connectionId: string;
  readonly status: RuleStatus;
  readonly origin: RuleOrigin;
  readonly priority: number;
}

export type RulePatch = Partial<
  Pick<Rule, 'name' | 'verdict' | 'predicate' | 'criterion' | 'threshold' | 'priority' | 'status'>
>;

export type NewRuleHistoryEntry = Omit<RuleHistoryEntry, 'id' | 'createdAt'>;

export interface IRuleStore {
  /** Ordered by priority, then age. */
  listForConnection(connectionId: string): Promise<readonly Rule[]>;
  get(id: string): Promise<Rule | null>;
  create(rule: NewRule): Promise<Rule>;
  update(id: string, patch: RulePatch): Promise<Rule | null>;
  remove(id: string): Promise<void>;
  recordHit(id: string): Promise<void>;
  appendHistory(entry: NewRuleHistoryEntry): Promise<void>;
  history(connectionId: string, limit: number): Promise<readonly RuleHistoryEntry[]>;
}
