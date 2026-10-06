import { asc, eq } from 'drizzle-orm';
import type {
  Connection,
  ConnectionPatch,
  ConnectorKind,
} from '@/core/connections/Connection.types';
import { ConnectionStatus } from '@/core/connections/Connection.types';
import type {
  IConnectionStore,
  StoredConnectionInput,
} from '@/core/connections/ConnectionStore.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { connections } from '@/infrastructure/db/schema';

type Row = typeof connections.$inferSelect;

export class SqliteConnectionStore implements IConnectionStore {
  constructor(private readonly db: Db) {}

  public create(input: StoredConnectionInput): Promise<Connection> {
    const row = this.db
      .insert(connections)
      .values({
        id: crypto.randomUUID(),
        kind: input.kind,
        name: input.name,
        config: input.config as Record<string, unknown>,
        cursor: {},
        secretsCiphertext: input.secretsCiphertext,
        enabled: true,
        status: ConnectionStatus.Idle,
        statusMessage: null,
        lastSyncAt: null,
        groupId: input.groupId,
        color: input.color,
        createdAt: new Date(),
      })
      .returning()
      .get();

    return Promise.resolve(SqliteConnectionStore.toConnection(row));
  }

  public get(id: string): Promise<Connection | null> {
    const row = this.db.select().from(connections).where(eq(connections.id, id)).get();

    return Promise.resolve(row ? SqliteConnectionStore.toConnection(row) : null);
  }

  public list(): Promise<readonly Connection[]> {
    const rows = this.db.select().from(connections).orderBy(asc(connections.createdAt)).all();

    return Promise.resolve(rows.map((row) => SqliteConnectionStore.toConnection(row)));
  }

  public update(id: string, patch: ConnectionPatch): Promise<Connection | null> {
    const row = this.db
      .update(connections)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.config !== undefined ? { config: patch.config } : {}),
        ...(patch.cursor !== undefined ? { cursor: patch.cursor } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.statusMessage !== undefined ? { statusMessage: patch.statusMessage } : {}),
        ...(patch.lastSyncAt !== undefined ? { lastSyncAt: patch.lastSyncAt } : {}),
        ...(patch.groupId !== undefined ? { groupId: patch.groupId } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
      })
      .where(eq(connections.id, id))
      .returning()
      .get();

    return Promise.resolve(row ? SqliteConnectionStore.toConnection(row) : null);
  }

  public updateSecrets(id: string, secretsCiphertext: string): Promise<void> {
    this.db.update(connections).set({ secretsCiphertext }).where(eq(connections.id, id)).run();

    return Promise.resolve();
  }

  public getSecretsCiphertext(id: string): Promise<string | null> {
    const row = this.db
      .select({ secretsCiphertext: connections.secretsCiphertext })
      .from(connections)
      .where(eq(connections.id, id))
      .get();

    return Promise.resolve(row?.secretsCiphertext ?? null);
  }

  public remove(id: string): Promise<void> {
    this.db.delete(connections).where(eq(connections.id, id)).run();

    return Promise.resolve();
  }

  private static toConnection(row: Row): Connection {
    return {
      id: row.id,
      kind: row.kind as ConnectorKind,
      name: row.name,
      config: row.config,
      cursor: row.cursor,
      enabled: row.enabled,
      status: row.status as ConnectionStatus,
      statusMessage: row.statusMessage,
      lastSyncAt: row.lastSyncAt,
      groupId: row.groupId,
      color: row.color,
      createdAt: row.createdAt,
    };
  }
}
