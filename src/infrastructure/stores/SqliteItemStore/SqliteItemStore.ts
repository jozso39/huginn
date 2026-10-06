import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type {
  Category,
  Item,
  ItemFeatures,
  ItemKind,
  ItemStatus,
  NewItem,
  RichContent,
} from '@/core/items/Item.types';
import { Category as CategoryEnum, ItemState } from '@/core/items/Item.types';
import type { IItemStore, ItemFilter, UpsertResult } from '@/core/items/ItemStore.types';
import { searchTermsOf, searchTextOf } from '@/core/items/search.utils';
import type { TriageDecision } from '@/core/triage/Rule.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { items } from '@/infrastructure/db/schema';

type Row = typeof items.$inferSelect;

// Items made searchable per round at boot: small transactions, nothing blocks long.
const INDEX_BATCH = 500;

export class SqliteItemStore implements IItemStore {
  constructor(private readonly db: Db) {}

  public upsert(newItem: NewItem): Promise<UpsertResult> {
    const existing = this.db
      .select()
      .from(items)
      .where(
        and(eq(items.connectionId, newItem.connectionId), eq(items.externalId, newItem.externalId))
      )
      .get();

    if (existing) {
      // Content may change (edited message, updated todo body); state, category
      // and the decision are the user's and must survive a refresh.
      const updated = this.db
        .update(items)
        .set({
          threadKey: newItem.threadKey,
          kind: newItem.kind,
          author: newItem.author,
          title: newItem.title,
          body: newItem.body,
          url: newItem.url,
          rich: newItem.rich ? { ...newItem.rich } : null,
          status: newItem.status ? { ...newItem.status } : null,
          appUrl: newItem.appUrl ?? null,
          receivedAt: newItem.receivedAt,
          features: newItem.features,
          raw: newItem.raw,
          searchText: searchTextOf(newItem),
        })
        .where(eq(items.id, existing.id))
        .returning()
        .get();

      return Promise.resolve({ item: SqliteItemStore.toItem(updated ?? existing), created: false });
    }

    const now = new Date();
    const inserted = this.db
      .insert(items)
      .values({
        id: crypto.randomUUID(),
        connectionId: newItem.connectionId,
        externalId: newItem.externalId,
        threadKey: newItem.threadKey,
        kind: newItem.kind,
        author: newItem.author,
        title: newItem.title,
        body: newItem.body,
        url: newItem.url,
        rich: newItem.rich ? { ...newItem.rich } : null,
        status: newItem.status ? { ...newItem.status } : null,
        appUrl: newItem.appUrl ?? null,
        receivedAt: newItem.receivedAt,
        features: newItem.features as Record<string, unknown>,
        raw: newItem.raw,
        category: CategoryEnum.Undecided,
        decidedByRuleId: null,
        decision: null,
        state: ItemState.Open,
        stateChangedAt: now,
        searchText: searchTextOf(newItem),
        createdAt: now,
      })
      .returning()
      .get();

    return Promise.resolve({ item: SqliteItemStore.toItem(inserted), created: true });
  }

  public get(id: string): Promise<Item | null> {
    const row = this.db.select().from(items).where(eq(items.id, id)).get();

    return Promise.resolve(row ? SqliteItemStore.toItem(row) : null);
  }

  public list(filter: ItemFilter): Promise<readonly Item[]> {
    const conditions = [
      filter.state ? eq(items.state, filter.state) : undefined,
      filter.category ? eq(items.category, filter.category) : undefined,
      filter.connectionId ? eq(items.connectionId, filter.connectionId) : undefined,
      ...searchTermsOf(filter.query ?? '').map(
        (term) =>
          sql`${items.searchText} LIKE ${`%${term.replace(/[\\%_]/g, '\\$&')}%`} ESCAPE '\\'`
      ),
    ].filter((condition) => condition !== undefined);

    const rows = this.db
      .select()
      .from(items)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(items.receivedAt))
      .limit(filter.limit ?? 200)
      .all();

    return Promise.resolve(rows.map((row) => SqliteItemStore.toItem(row)));
  }

  public indexForSearch(): Promise<number> {
    const round = (done: number): number => {
      const rows = this.db
        .select({ id: items.id, title: items.title, author: items.author, body: items.body })
        .from(items)
        .where(isNull(items.searchText))
        .limit(INDEX_BATCH)
        .all();

      if (rows.length === 0) {
        return done;
      }

      this.db.transaction((tx) =>
        rows.forEach((row) =>
          tx
            .update(items)
            .set({ searchText: searchTextOf(row) })
            .where(eq(items.id, row.id))
            .run()
        )
      );

      return round(done + rows.length);
    };

    return Promise.resolve(round(0));
  }

  public setState(id: string, state: ItemState): Promise<Item | null> {
    const row = this.db
      .update(items)
      .set({ state, stateChangedAt: new Date() })
      .where(eq(items.id, id))
      .returning()
      .get();

    return Promise.resolve(row ? SqliteItemStore.toItem(row) : null);
  }

  public setDecision(id: string, decision: TriageDecision): Promise<Item | null> {
    const row = this.db
      .update(items)
      .set({
        category: decision.category,
        decidedByRuleId: decision.ruleId,
        decision: { ...decision },
      })
      .where(eq(items.id, id))
      .returning()
      .get();

    return Promise.resolve(row ? SqliteItemStore.toItem(row) : null);
  }

  public closeOpenExcept(
    connectionId: string,
    keepExternalIds: readonly string[]
  ): Promise<readonly Item[]> {
    const rows = this.db
      .update(items)
      .set({ state: ItemState.Done, stateChangedAt: new Date() })
      .where(
        and(
          eq(items.connectionId, connectionId),
          eq(items.state, ItemState.Open),
          // notInArray with an empty list is a SQL error in drizzle, hence the guard.
          keepExternalIds.length > 0
            ? notInArray(items.externalId, [...keepExternalIds])
            : undefined
        )
      )
      .returning()
      .all();

    return Promise.resolve(rows.map((row) => SqliteItemStore.toItem(row)));
  }

  public closeThread(connectionId: string, threadKey: string): Promise<readonly Item[]> {
    const rows = this.db
      .update(items)
      .set({ state: ItemState.Done, stateChangedAt: new Date() })
      .where(
        and(
          eq(items.connectionId, connectionId),
          eq(items.threadKey, threadKey),
          eq(items.state, ItemState.Open)
        )
      )
      .returning()
      .all();

    return Promise.resolve(rows.map((row) => SqliteItemStore.toItem(row)));
  }

  public closeByExternalIds(
    connectionId: string,
    externalIds: readonly string[]
  ): Promise<readonly Item[]> {
    if (externalIds.length === 0) {
      return Promise.resolve([]);
    }

    const rows = this.db
      .update(items)
      .set({ state: ItemState.Done, stateChangedAt: new Date() })
      .where(
        and(
          eq(items.connectionId, connectionId),
          eq(items.state, ItemState.Open),
          inArray(items.externalId, [...externalIds])
        )
      )
      .returning()
      .all();

    return Promise.resolve(rows.map((row) => SqliteItemStore.toItem(row)));
  }

  private static toItem(row: Row): Item {
    return {
      id: row.id,
      connectionId: row.connectionId,
      externalId: row.externalId,
      threadKey: row.threadKey,
      kind: row.kind as ItemKind,
      author: row.author,
      title: row.title,
      body: row.body,
      url: row.url,
      rich: (row.rich ?? null) as RichContent | null,
      status: (row.status ?? null) as ItemStatus | null,
      appUrl: row.appUrl ?? null,
      receivedAt: row.receivedAt,
      features: row.features as ItemFeatures,
      raw: row.raw,
      category: row.category as Category,
      decidedByRuleId: row.decidedByRuleId,
      decision: (row.decision ?? null) as TriageDecision | null,
      state: row.state as ItemState,
      stateChangedAt: row.stateChangedAt,
      createdAt: row.createdAt,
    };
  }
}
