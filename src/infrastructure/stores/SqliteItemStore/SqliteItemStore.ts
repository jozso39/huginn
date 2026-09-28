import { and, desc, eq, notInArray } from 'drizzle-orm';
import type { Category, Item, ItemFeatures, ItemKind, NewItem } from '@/core/items/Item.types';
import { Category as CategoryEnum, ItemState } from '@/core/items/Item.types';
import type { IItemStore, ItemFilter, UpsertResult } from '@/core/items/ItemStore.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { items } from '@/infrastructure/db/schema';

type Row = typeof items.$inferSelect;

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
          receivedAt: newItem.receivedAt,
          features: newItem.features,
          raw: newItem.raw,
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
        receivedAt: newItem.receivedAt,
        features: newItem.features as Record<string, unknown>,
        raw: newItem.raw,
        category: CategoryEnum.Undecided,
        decidedByRuleId: null,
        state: ItemState.Open,
        stateChangedAt: now,
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

  public setState(id: string, state: ItemState): Promise<Item | null> {
    const row = this.db
      .update(items)
      .set({ state, stateChangedAt: new Date() })
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
      receivedAt: row.receivedAt,
      features: row.features as ItemFeatures,
      raw: row.raw,
      category: row.category as Category,
      decidedByRuleId: row.decidedByRuleId,
      state: row.state as ItemState,
      stateChangedAt: row.stateChangedAt,
      createdAt: row.createdAt,
    };
  }
}
