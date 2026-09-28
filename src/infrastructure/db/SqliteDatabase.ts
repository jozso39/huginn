import { Database } from 'bun:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import type { Logger } from '@/lib/logger';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Opens (or creates) the SQLite file and applies the SQL migrations shipped in
 * drizzle/. Migrations run at boot on purpose: the Pi never has drizzle-kit
 * installed, and a container that starts is a container with a current schema.
 */
export class SqliteDatabase {
  public readonly db: Db;
  private readonly sqlite: Database;

  constructor(
    private readonly logger: Logger,
    path: string
  ) {
    if (path !== ':memory:') {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }

    this.sqlite = new Database(path, { create: true, strict: true });
    // WAL lets the backup script take a consistent .backup while pollers write.
    this.sqlite.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;'
    );
    this.db = drizzle(this.sqlite, { schema });
  }

  public migrate(migrationsFolder: string): void {
    migrate(this.db, { migrationsFolder });
    this.logger.debug({ migrationsFolder }, 'database migrated');
  }

  public close(): void {
    this.sqlite.close();
  }
}
