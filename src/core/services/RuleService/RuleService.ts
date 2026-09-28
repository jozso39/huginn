import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import type { IItemStore } from '@/core/items/ItemStore.types';
import { describePredicate, predicateSchema } from '@/core/triage/predicate.utils';
import type { Rule, RuleDraft, RuleHistoryEntry } from '@/core/triage/Rule.types';
import {
  RuleChange,
  RuleKind,
  RuleOrigin,
  RuleStatus,
  RuleVerdict,
} from '@/core/triage/Rule.types';
import type { IRuleStore } from '@/core/triage/RuleStore.types';
import type { ITriageService } from '@/core/services/TriageService/TriageService.types';
import type { FieldInfo, IRuleService, RuleChangeContext, RuleView } from './RuleService.types';
import { MoveDirection } from './RuleService.types';

/** Gaps between priorities leave room to slot a rule in without renumbering. */
const PRIORITY_STEP = 10;
const HISTORY_LIMIT = 100;
const ITEM_FIELDS = ['author', 'title', 'kind'];

const draftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal(RuleKind.Hard),
    name: z.string().trim().min(1).max(80),
    verdict: z.enum(RuleVerdict),
    predicate: predicateSchema,
    criterion: z.null().optional(),
    threshold: z.number().optional(),
  }),
  z.object({
    kind: z.literal(RuleKind.Soft),
    name: z.string().trim().min(1).max(80),
    verdict: z.enum(RuleVerdict),
    predicate: z.null().optional(),
    // A criterion is one clear yes/no statement; a paragraph is several questions.
    criterion: z.string().trim().min(10).max(300),
    threshold: z.number().min(0.5).max(0.99).default(0.7),
  }),
]);

const snapshot = (rule: Rule): Record<string, unknown> => ({
  name: rule.name,
  verdict: rule.verdict,
  kind: rule.kind,
  predicate: rule.predicate,
  criterion: rule.criterion,
  threshold: rule.threshold,
  priority: rule.priority,
  status: rule.status,
});

export class RuleService implements IRuleService {
  constructor(
    private readonly logger: Logger,
    private readonly ruleStore: IRuleStore,
    private readonly triage: ITriageService,
    private readonly itemStore: IItemStore,
    private readonly connectionStore: IConnectionStore,
    private readonly factories: readonly IConnectorFactory[]
  ) {}

  public async list(connectionId: string): Promise<readonly RuleView[]> {
    const rules = await this.ruleStore.listForConnection(connectionId);

    return rules.map((rule) => ({
      ...rule,
      description:
        rule.kind === RuleKind.Hard && rule.predicate
          ? describePredicate(rule.predicate)
          : (rule.criterion ?? ''),
    }));
  }

  public history(connectionId: string): Promise<readonly RuleHistoryEntry[]> {
    return this.ruleStore.history(connectionId, HISTORY_LIMIT);
  }

  public get(id: string): Promise<Rule | null> {
    return this.ruleStore.get(id);
  }

  public validate(draft: RuleDraft): RuleDraft {
    const result = draftSchema.safeParse(draft);

    if (!result.success) {
      throw new HuginnError(ErrorCode.Validation, 'invalid rule', result.error.issues);
    }

    return result.data;
  }

  public async create(
    connectionId: string,
    draft: RuleDraft,
    context: RuleChangeContext
  ): Promise<Rule> {
    const valid = this.validate(draft);
    const existing = await this.ruleStore.listForConnection(connectionId);
    const last = existing.at(-1)?.priority ?? 0;
    const rule = await this.ruleStore.create({
      ...valid,
      connectionId,
      status: context.status ?? RuleStatus.Active,
      origin: context.origin,
      priority: context.priority ?? last + PRIORITY_STEP,
    });

    await this.record(rule, RuleChange.Created, null, context);
    this.retriageLater(rule);

    return rule;
  }

  public async update(id: string, draft: RuleDraft, context: RuleChangeContext): Promise<Rule> {
    const before = await this.require(id);
    const valid = this.validate(draft);
    const rule =
      (await this.ruleStore.update(id, {
        name: valid.name,
        verdict: valid.verdict,
        predicate: valid.kind === RuleKind.Hard ? (valid.predicate ?? null) : null,
        criterion: valid.kind === RuleKind.Soft ? (valid.criterion ?? null) : null,
        ...(valid.threshold !== undefined ? { threshold: valid.threshold } : {}),
        ...(context.status ? { status: context.status } : {}),
        ...(context.priority !== undefined ? { priority: context.priority } : {}),
      })) ?? before;

    await this.record(rule, RuleChange.Updated, before, context);
    this.retriageLater(rule);

    return rule;
  }

  public async setStatus(id: string, status: RuleStatus): Promise<Rule> {
    const before = await this.require(id);
    const rule = (await this.ruleStore.update(id, { status })) ?? before;
    const change =
      status === RuleStatus.Disabled
        ? RuleChange.Disabled
        : before.status === RuleStatus.Proposed
          ? RuleChange.Approved
          : RuleChange.Enabled;

    await this.record(rule, change, before, { origin: RuleOrigin.User });
    this.retriageLater(rule);

    return rule;
  }

  public async move(id: string, direction: MoveDirection): Promise<void> {
    const rule = await this.require(id);
    const rules = await this.ruleStore.listForConnection(rule.connectionId);
    const index = rules.findIndex((candidate) => candidate.id === id);
    const neighbour = rules[direction === MoveDirection.Up ? index - 1 : index + 1];

    if (!neighbour) {
      return;
    }

    // Renumber the whole list in steps so equal priorities can never tie.
    const reordered = rules.map((candidate) =>
      candidate.id === id ? neighbour : candidate.id === neighbour.id ? rule : candidate
    );

    await Promise.all(
      reordered.map((candidate, position) =>
        this.ruleStore.update(candidate.id, { priority: (position + 1) * PRIORITY_STEP })
      )
    );
    await this.record(rule, RuleChange.Updated, rule, { origin: RuleOrigin.User });
    this.retriageLater(rule);
  }

  public async remove(id: string): Promise<void> {
    const rule = await this.require(id);

    await this.ruleStore.remove(id);
    await this.record(rule, RuleChange.Deleted, rule, { origin: RuleOrigin.User });
    this.retriageLater(rule);
  }

  public async installDefaults(connectionId: string): Promise<number> {
    const connection = await this.connectionStore.get(connectionId);
    const defaults =
      this.factories.find((factory) => factory.kind === connection?.kind)?.defaultRules ?? [];

    // Sequential on purpose: each takes the next priority.
    await defaults.reduce<Promise<void>>(async (previous, draft, index) => {
      await previous;

      const rule = await this.ruleStore.create({
        ...this.validate(draft),
        connectionId,
        status: RuleStatus.Active,
        origin: RuleOrigin.Default,
        priority: (index + 1) * PRIORITY_STEP,
      });

      await this.record(rule, RuleChange.Created, null, { origin: RuleOrigin.Default });
    }, Promise.resolve());

    if (defaults.length > 0) {
      await this.triage.retriage(connectionId);
    }

    return defaults.length;
  }

  public async installMissingDefaults(): Promise<void> {
    const connections = await this.connectionStore.list();

    await Promise.all(
      connections.map(async (connection) => {
        // History, not current rules: a user who deleted every default keeps it that way.
        const history = await this.ruleStore.history(connection.id, 1);

        if (history.length === 0) {
          const added = await this.installDefaults(connection.id);

          this.logger.info({ connectionId: connection.id, added }, 'default rules installed');
        }
      })
    );
  }

  public async fields(connectionId: string): Promise<readonly FieldInfo[]> {
    const items = await this.itemStore.list({ connectionId, limit: 100 });
    const keys = [...new Set(items.flatMap((item) => Object.keys(item.features)))].sort();
    const samplesOf = (read: (item: (typeof items)[number]) => unknown) =>
      [
        ...new Set(
          items
            .map(read)
            .filter((value) => value !== null && value !== undefined)
            .map(String)
        ),
      ].slice(0, 6);

    return [
      ...ITEM_FIELDS.map((field) => ({
        field,
        samples: samplesOf((item) => item[field as 'author' | 'title' | 'kind']),
      })),
      ...keys.map((field) => ({ field, samples: samplesOf((item) => item.features[field]) })),
    ];
  }

  private async record(
    rule: Rule,
    change: RuleChange,
    before: Rule | null,
    context: RuleChangeContext
  ): Promise<void> {
    await this.ruleStore.appendHistory({
      ruleId: rule.id,
      connectionId: rule.connectionId,
      change,
      origin: context.origin,
      before: before ? snapshot(before) : null,
      after: change === RuleChange.Deleted ? null : snapshot(rule),
      reason: context.reason ?? null,
      itemId: context.itemId ?? null,
      checks: context.checks ?? null,
    });
  }

  /**
   * Re-sorting the waiting items can take Jev a few seconds; the caller gets its
   * answer now and the dashboard hears about moved items as they move.
   */
  private retriageLater(rule: Rule): void {
    void this.triage.retriage(rule.connectionId).catch((error: unknown) => {
      this.logger.warn({ err: toError(error), connectionId: rule.connectionId }, 'retriage failed');
    });
  }

  private async require(id: string): Promise<Rule> {
    const rule = await this.ruleStore.get(id);

    if (!rule) {
      throw new HuginnError(ErrorCode.NotFound, `rule ${id} not found`);
    }

    return rule;
  }
}
