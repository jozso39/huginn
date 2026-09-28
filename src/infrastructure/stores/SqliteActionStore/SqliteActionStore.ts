import { asc, eq } from 'drizzle-orm';
import type { Action, ActionType, NewAction } from '@/core/actions/Action.types';
import type { IActionStore } from '@/core/actions/ActionStore.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { actions } from '@/infrastructure/db/schema';

type Row = typeof actions.$inferSelect;

export class SqliteActionStore implements IActionStore {
  constructor(private readonly db: Db) {}

  public append(action: NewAction): Promise<Action> {
    const row = this.db
      .insert(actions)
      .values({
        id: crypto.randomUUID(),
        itemId: action.itemId,
        type: action.type,
        payload: action.payload as Record<string, unknown>,
        result: action.result,
        createdAt: new Date(),
      })
      .returning()
      .get();

    return Promise.resolve(SqliteActionStore.toAction(row));
  }

  public listForItem(itemId: string): Promise<readonly Action[]> {
    const rows = this.db
      .select()
      .from(actions)
      .where(eq(actions.itemId, itemId))
      .orderBy(asc(actions.createdAt))
      .all();

    return Promise.resolve(rows.map((row) => SqliteActionStore.toAction(row)));
  }

  private static toAction(row: Row): Action {
    return {
      id: row.id,
      itemId: row.itemId,
      type: row.type as ActionType,
      payload: row.payload,
      result: row.result ?? null,
      createdAt: row.createdAt,
    };
  }
}
