import { eq } from 'drizzle-orm';
import type { IPushDeviceStore, NewPushDevice, PushDevice } from '@/core/push/PushDevice.types';
import type { Db } from '@/infrastructure/db/SqliteDatabase';
import { pushDevices } from '@/infrastructure/db/schema';

export class SqlitePushDeviceStore implements IPushDeviceStore {
  constructor(private readonly db: Db) {}

  public list(): Promise<readonly PushDevice[]> {
    return Promise.resolve(this.db.select().from(pushDevices).all());
  }

  public save(device: NewPushDevice): Promise<PushDevice> {
    const keys = { p256dh: device.p256dh, auth: device.auth, label: device.label };
    const saved = this.db
      .insert(pushDevices)
      .values({
        id: crypto.randomUUID(),
        endpoint: device.endpoint,
        createdAt: new Date(),
        ...keys,
      })
      .onConflictDoUpdate({ target: pushDevices.endpoint, set: keys })
      .returning()
      .get();

    return Promise.resolve(saved);
  }

  public removeByEndpoint(endpoint: string): Promise<boolean> {
    const removed = this.db
      .delete(pushDevices)
      .where(eq(pushDevices.endpoint, endpoint))
      .returning()
      .all();

    return Promise.resolve(removed.length > 0);
  }
}
