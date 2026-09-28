import type { Category, Item } from '@/core/items/Item.types';
import type { Rule, RuleDraft, TriageDecision } from '@/core/triage/Rule.types';

export interface DryRunHit {
  readonly itemId: string;
  readonly title: string;
  readonly author: string;
  readonly currentCategory: Category;
  /** The user put it there by hand: a rule disagreeing with it is suspect. */
  readonly userDecided: boolean;
  /** Jev's probability, for soft rules. */
  readonly probability: number | null;
}

export interface DryRunResult {
  readonly evaluated: number;
  readonly hits: readonly DryRunHit[];
  /** Hits where the user had put the item in the other category by hand. */
  readonly conflicts: number;
}

export interface RetriageResult {
  readonly evaluated: number;
  readonly changed: number;
}

/** Puts every item in Important, Undecided or Spam, and says which rule did it. */
export interface ITriageService {
  /** The decision for an item under the connection's active rules (no side effects). */
  classify(item: Item, rules?: readonly Rule[]): Promise<TriageDecision>;
  /** Classifies and stores the decision. Items the user placed by hand are left alone. */
  triage(item: Item): Promise<Item>;
  /** Re-runs triage on the connection's open items, e.g. after its rules changed. */
  retriage(connectionId: string): Promise<RetriageResult>;
  /** Where a rule would fire among the connection's recent items. */
  dryRun(connectionId: string, draft: RuleDraft, limit?: number): Promise<DryRunResult>;
}
