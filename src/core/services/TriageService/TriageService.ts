import type { Logger } from '@/lib/logger';
import type { IJevClient } from '@/core/clients/JevClient/JevClient.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type { IEventBus } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import { toError } from '@/core/errors/errors';
import type { Item } from '@/core/items/Item.types';
import { Category, ItemState } from '@/core/items/Item.types';
import type { IItemStore } from '@/core/items/ItemStore.types';
import { evaluatePredicate } from '@/core/triage/predicate.utils';
import type { Rule, RuleDraft, TriageDecision } from '@/core/triage/Rule.types';
import { DecisionSource, RuleKind, RuleStatus, RuleVerdict } from '@/core/triage/Rule.types';
import type { IRuleStore } from '@/core/triage/RuleStore.types';
import type {
  DryRunHit,
  DryRunResult,
  ITriageService,
  RetriageResult,
} from './TriageService.types';

/** What Jev reads about an item. Bodies are capped: the gist is at the top. */
const STATE_BODY_CHARS = 2_000;
/** Parallel Jev calls when re-running over many items; each is ~0.5 s. */
const CONCURRENCY = 5;
const DEFAULT_THRESHOLD = 0.7;

const verdictCategory = (verdict: RuleVerdict): Category =>
  verdict === RuleVerdict.Important ? Category.Important : Category.Spam;

export class TriageService implements ITriageService {
  constructor(
    private readonly logger: Logger,
    private readonly ruleStore: IRuleStore,
    private readonly itemStore: IItemStore,
    private readonly connectionStore: IConnectionStore,
    private readonly jev: IJevClient,
    private readonly eventBus: IEventBus
  ) {}

  public async classify(item: Item, rules?: readonly Rule[]): Promise<TriageDecision> {
    const active = (rules ?? (await this.ruleStore.listForConnection(item.connectionId))).filter(
      (rule) => rule.status === RuleStatus.Active
    );
    const state = await this.stateOf(item);
    // Rules run in priority order and the first that fires decides. Jev is only
    // asked once a soft rule is actually reached, and then about all remaining
    // soft rules at once — one call, not one per rule.
    const walk = async (
      index: number,
      probabilities: Readonly<Record<string, number>> | null,
      unavailable: boolean
    ): Promise<TriageDecision> => {
      const rule = active[index];

      if (!rule) {
        return this.decision(
          Category.Undecided,
          unavailable ? DecisionSource.ClassifierUnavailable : DecisionSource.NoRule,
          null,
          probabilities ?? {}
        );
      }

      if (rule.kind === RuleKind.Hard) {
        return rule.predicate && evaluatePredicate(rule.predicate, item)
          ? this.decision(
              verdictCategory(rule.verdict),
              DecisionSource.Rule,
              rule,
              probabilities ?? {}
            )
          : walk(index + 1, probabilities, unavailable);
      }

      if (probabilities === null && !unavailable) {
        const asked = await this.askSoftRules(state, active.slice(index));

        return walk(index, asked ?? {}, asked === null);
      }

      const probability = probabilities?.[rule.id];

      return probability !== undefined && probability >= rule.threshold
        ? this.decision(
            verdictCategory(rule.verdict),
            DecisionSource.Rule,
            rule,
            probabilities ?? {}
          )
        : walk(index + 1, probabilities, unavailable);
    };

    return walk(0, null, false);
  }

  public async triage(item: Item): Promise<Item> {
    if (item.decision?.source === DecisionSource.User) {
      return item;
    }

    const decision = await this.classify(item);

    if (decision.ruleId) {
      await this.ruleStore.recordHit(decision.ruleId);
    }

    return (await this.itemStore.setDecision(item.id, decision)) ?? item;
  }

  public async retriage(connectionId: string): Promise<RetriageResult> {
    const [rules, items] = await Promise.all([
      this.ruleStore.listForConnection(connectionId),
      this.itemStore.list({ connectionId, state: ItemState.Open, limit: 500 }),
    ]);
    const candidates = items.filter((item) => item.decision?.source !== DecisionSource.User);
    const outcomes = await TriageService.mapLimited(candidates, async (item) => {
      const decision = await this.classify(item, rules);
      const updated = await this.itemStore.setDecision(item.id, decision);
      const moved = decision.category !== item.category;

      // Only moves are news to the dashboard; a re-confirmed category is not.
      if (updated && moved) {
        this.eventBus.publish({ type: HuginnEventType.ItemChanged, item: updated });
      }

      return moved;
    });

    return { evaluated: candidates.length, changed: outcomes.filter(Boolean).length };
  }

  public async dryRun(connectionId: string, draft: RuleDraft, limit = 50): Promise<DryRunResult> {
    const items = await this.itemStore.list({ connectionId, limit });
    const target = verdictCategory(draft.verdict);
    const results = await TriageService.mapLimited(
      items,
      async (item): Promise<DryRunHit | null> => {
        const probability =
          draft.kind === RuleKind.Soft && draft.criterion
            ? ((
                await this.askSoftRules(await this.stateOf(item), [
                  { id: 'draft', criterion: draft.criterion },
                ])
              )?.draft ?? null)
            : null;
        const fires =
          draft.kind === RuleKind.Hard
            ? Boolean(draft.predicate && evaluatePredicate(draft.predicate, item))
            : probability !== null && probability >= (draft.threshold ?? DEFAULT_THRESHOLD);

        return fires
          ? {
              itemId: item.id,
              title: item.title,
              author: item.author,
              currentCategory: item.category,
              userDecided: item.decision?.source === DecisionSource.User,
              probability,
            }
          : null;
      }
    );
    const hits = results.filter((hit) => hit !== null);

    return {
      evaluated: items.length,
      hits,
      conflicts: hits.filter((hit) => hit.userDecided && hit.currentCategory !== target).length,
    };
  }

  /** Null when Jev is not configured or failed; the caller treats soft rules as silent. */
  private async askSoftRules(
    state: Readonly<Record<string, unknown>>,
    rules: readonly Pick<Rule, 'id' | 'criterion'>[]
  ): Promise<Record<string, number> | null> {
    const soft = rules.filter((rule) => rule.criterion);

    if (soft.length === 0) {
      return {};
    }

    if (!this.jev.available()) {
      return null;
    }

    // Short positional keys: rule ids are UUIDs and Jev's key rules are undocumented.
    const questions = Object.fromEntries(soft.map((rule, i) => [`q${i}`, rule.criterion ?? '']));

    try {
      const answers = await this.jev.nouls(state, questions);

      return Object.fromEntries(soft.map((rule, i) => [rule.id, answers[`q${i}`] ?? 0]));
    } catch (error) {
      this.logger.warn({ err: toError(error) }, 'jev unavailable, soft rules skipped');

      return null;
    }
  }

  private async stateOf(item: Item): Promise<Record<string, unknown>> {
    const connection = await this.connectionStore.get(item.connectionId);

    return {
      source: connection?.kind ?? 'unknown',
      kind: item.kind,
      from: item.author,
      title: item.title,
      body: item.body.slice(0, STATE_BODY_CHARS),
      metadata: item.features,
    };
  }

  private decision(
    category: Category,
    source: DecisionSource,
    rule: Rule | null,
    probabilities: Readonly<Record<string, number>>
  ): TriageDecision {
    return {
      category,
      source,
      ruleId: rule?.id ?? null,
      ruleName: rule?.name ?? null,
      probabilities,
      decidedAt: new Date().toISOString(),
    };
  }

  private static async mapLimited<T, R>(
    items: readonly T[],
    work: (item: T) => Promise<R>
  ): Promise<R[]> {
    const chunks = Array.from({ length: Math.ceil(items.length / CONCURRENCY) }, (_, index) =>
      items.slice(index * CONCURRENCY, index * CONCURRENCY + CONCURRENCY)
    );

    return chunks.reduce<Promise<R[]>>(
      async (done, chunk) => [...(await done), ...(await Promise.all(chunk.map(work)))],
      Promise.resolve([])
    );
  }
}
