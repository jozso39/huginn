import { asc, desc, eq, sql } from 'drizzle-orm';
import type {
  Predicate,
  Rule,
  RuleChange,
  RuleHistoryEntry,
  RuleKind,
  RuleOrigin,
  RuleStatus,
  RuleVerdict,
} from '@/core/triage/Rule.types';
import type {
  IRuleStore,
  NewRule,
  NewRuleHistoryEntry,
  RulePatch,
} from '@/core/triage/RuleStore.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { ruleHistory, rules } from '@/infrastructure/db/schema';

type Row = typeof rules.$inferSelect;
type HistoryRow = typeof ruleHistory.$inferSelect;

/** Soft rules fire at 0.7 unless told otherwise: Jev is calibrated, so 0.7 means 0.7. */
const DEFAULT_THRESHOLD = 0.7;

export class SqliteRuleStore implements IRuleStore {
  constructor(private readonly db: Db) {}

  public listForConnection(connectionId: string): Promise<readonly Rule[]> {
    const rows = this.db
      .select()
      .from(rules)
      .where(eq(rules.connectionId, connectionId))
      .orderBy(asc(rules.priority), asc(rules.createdAt))
      .all();

    return Promise.resolve(rows.map((row) => SqliteRuleStore.toRule(row)));
  }

  public get(id: string): Promise<Rule | null> {
    const row = this.db.select().from(rules).where(eq(rules.id, id)).get();

    return Promise.resolve(row ? SqliteRuleStore.toRule(row) : null);
  }

  public create(rule: NewRule): Promise<Rule> {
    const now = new Date();
    const row = this.db
      .insert(rules)
      .values({
        id: crypto.randomUUID(),
        connectionId: rule.connectionId,
        name: rule.name,
        verdict: rule.verdict,
        kind: rule.kind,
        predicate: rule.predicate ?? null,
        criterion: rule.criterion ?? null,
        threshold: rule.threshold ?? DEFAULT_THRESHOLD,
        priority: rule.priority,
        status: rule.status,
        origin: rule.origin,
        hits: 0,
        lastHitAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return Promise.resolve(SqliteRuleStore.toRule(row));
  }

  public update(id: string, patch: RulePatch): Promise<Rule | null> {
    const row = this.db
      .update(rules)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.verdict !== undefined ? { verdict: patch.verdict } : {}),
        ...(patch.predicate !== undefined ? { predicate: patch.predicate } : {}),
        ...(patch.criterion !== undefined ? { criterion: patch.criterion } : {}),
        ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(rules.id, id))
      .returning()
      .get();

    return Promise.resolve(row ? SqliteRuleStore.toRule(row) : null);
  }

  public remove(id: string): Promise<void> {
    this.db.delete(rules).where(eq(rules.id, id)).run();

    return Promise.resolve();
  }

  public recordHit(id: string): Promise<void> {
    this.db
      .update(rules)
      .set({ hits: sql`${rules.hits} + 1`, lastHitAt: new Date() })
      .where(eq(rules.id, id))
      .run();

    return Promise.resolve();
  }

  public appendHistory(entry: NewRuleHistoryEntry): Promise<void> {
    this.db
      .insert(ruleHistory)
      .values({
        id: crypto.randomUUID(),
        ruleId: entry.ruleId,
        connectionId: entry.connectionId,
        change: entry.change,
        origin: entry.origin,
        before: entry.before ? { ...entry.before } : null,
        after: entry.after ? { ...entry.after } : null,
        reason: entry.reason,
        itemId: entry.itemId,
        checks: entry.checks ? { ...entry.checks } : null,
        createdAt: new Date(),
      })
      .run();

    return Promise.resolve();
  }

  public history(connectionId: string, limit: number): Promise<readonly RuleHistoryEntry[]> {
    const rows = this.db
      .select()
      .from(ruleHistory)
      .where(eq(ruleHistory.connectionId, connectionId))
      .orderBy(desc(ruleHistory.createdAt))
      .limit(limit)
      .all();

    return Promise.resolve(rows.map((row) => SqliteRuleStore.toHistory(row)));
  }

  private static toRule(row: Row): Rule {
    return {
      id: row.id,
      connectionId: row.connectionId,
      name: row.name,
      verdict: row.verdict as RuleVerdict,
      kind: row.kind as RuleKind,
      predicate: (row.predicate ?? null) as Predicate | null,
      criterion: row.criterion,
      threshold: row.threshold,
      priority: row.priority,
      status: row.status as RuleStatus,
      origin: row.origin as RuleOrigin,
      hits: row.hits,
      lastHitAt: row.lastHitAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private static toHistory(row: HistoryRow): RuleHistoryEntry {
    return {
      id: row.id,
      ruleId: row.ruleId,
      connectionId: row.connectionId,
      change: row.change as RuleChange,
      origin: row.origin as RuleOrigin,
      before: row.before ?? null,
      after: row.after ?? null,
      reason: row.reason,
      itemId: row.itemId,
      checks: row.checks ?? null,
      createdAt: row.createdAt,
    };
  }
}
