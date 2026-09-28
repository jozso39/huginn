import { eq } from 'drizzle-orm';
import type {
  IOAuthAppStore,
  OAuthProvider,
  RedirectMode,
  StoredOAuthApp,
} from '@/core/oauth/OAuthApp.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { oauthApps } from '@/infrastructure/db/schema';

export class SqliteOAuthAppStore implements IOAuthAppStore {
  constructor(private readonly db: Db) {}

  public get(provider: OAuthProvider): Promise<StoredOAuthApp | null> {
    const row = this.db.select().from(oauthApps).where(eq(oauthApps.provider, provider)).get();

    return Promise.resolve(
      row
        ? {
            provider: row.provider as OAuthProvider,
            clientId: row.clientId,
            redirectMode: row.redirectMode as RedirectMode,
            secretCiphertext: row.secretCiphertext,
          }
        : null
    );
  }

  public save(app: StoredOAuthApp): Promise<void> {
    const values = {
      clientId: app.clientId,
      redirectMode: app.redirectMode,
      secretCiphertext: app.secretCiphertext,
      updatedAt: new Date(),
    };

    this.db
      .insert(oauthApps)
      .values({ provider: app.provider, ...values })
      .onConflictDoUpdate({ target: oauthApps.provider, set: values })
      .run();

    return Promise.resolve();
  }
}
