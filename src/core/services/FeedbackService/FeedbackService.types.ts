import type { Item } from '@/core/items/Item.types';
import type { Rule, RuleVerdict } from '@/core/triage/Rule.types';

export enum FeedbackOutcome {
  /** A new active rule now covers messages like this one. */
  RuleCreated = 'RuleCreated',
  /** An existing rule was changed. */
  RuleUpdated = 'RuleUpdated',
  /** A rule was suggested but a check failed: it waits for approval on the rules page. */
  Proposed = 'Proposed',
  /** Only this item moved; no rule change was sensible or possible. */
  ItemOnly = 'ItemOnly',
}

export interface FeedbackResult {
  readonly item: Item;
  readonly outcome: FeedbackOutcome;
  readonly rule: Rule | null;
  /** One sentence for the dashboard: what happened and why. */
  readonly message: string;
}

/** The Spam / Important buttons: move the item, and teach the rules if told why. */
export interface IFeedbackService {
  mark(itemId: string, verdict: RuleVerdict, explanation: string): Promise<FeedbackResult>;
}
