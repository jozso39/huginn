import { asc, eq, sql } from 'drizzle-orm';
import type {
  ConnectionGroup,
  IConnectionGroupStore,
} from '@/core/connections/ConnectionGroup.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { connectionGroups, connections } from '@/infrastructure/db/schema';

type Row = typeof connectionGroups.$inferSelect;

export class SqliteConnectionGroupStore implements IConnectionGroupStore {
  constructor(private readonly db: Db) {}

  public list(): Promise<readonly ConnectionGroup[]> {
    const rows = this.db
      .select()
      .from(connectionGroups)
      .orderBy(asc(sql`${connectionGroups.name} COLLATE NOCASE`))
      .all();

    return Promise.resolve(rows.map((row) => SqliteConnectionGroupStore.toGroup(row)));
  }

  public get(id: string): Promise<ConnectionGroup | null> {
    const row = this.db.select().from(connectionGroups).where(eq(connectionGroups.id, id)).get();

    return Promise.resolve(row ? SqliteConnectionGroupStore.toGroup(row) : null);
  }

  public create(name: string): Promise<ConnectionGroup> {
    const row = this.db
      .insert(connectionGroups)
      .values({ id: crypto.randomUUID(), name, createdAt: new Date() })
      .returning()
      .get();

    return Promise.resolve(SqliteConnectionGroupStore.toGroup(row));
  }

  public rename(id: string, name: string): Promise<ConnectionGroup | null> {
    const row = this.db
      .update(connectionGroups)
      .set({ name })
      .where(eq(connectionGroups.id, id))
      .returning()
      .get();

    return Promise.resolve(row ? SqliteConnectionGroupStore.toGroup(row) : null);
  }

  public remove(id: string): Promise<void> {
    // The foreign key would do this too; explicit, so it never depends on the pragma.
    this.db.transaction((tx) => {
      tx.update(connections).set({ groupId: null }).where(eq(connections.groupId, id)).run();
      tx.delete(connectionGroups).where(eq(connectionGroups.id, id)).run();
    });

    return Promise.resolve();
  }

  private static toGroup(row: Row): ConnectionGroup {
    return { id: row.id, name: row.name, createdAt: row.createdAt };
  }
}
