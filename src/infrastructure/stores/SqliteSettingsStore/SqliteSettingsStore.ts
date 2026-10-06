import { eq } from 'drizzle-orm';
import type { ISettingsStore } from '@/core/settings/Settings.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { settings } from '@/infrastructure/db/schema';

export class SqliteSettingsStore implements ISettingsStore {
  constructor(private readonly db: Db) {}

  public get(key: string): Promise<unknown> {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();

    return Promise.resolve(row?.value);
  }

  public set(key: string, value: unknown): Promise<void> {
    const updatedAt = new Date();

    this.db
      .insert(settings)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
      .run();

    return Promise.resolve();
  }
}
