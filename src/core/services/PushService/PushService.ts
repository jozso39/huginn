import type { Logger } from '@/lib/logger';
import type { IPushClient, PushMessage } from '@/core/clients/PushClient/PushClient.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type { IEventBus, Unsubscribe } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import type { Item } from '@/core/items/Item.types';
import { Category, ItemState } from '@/core/items/Item.types';
import type { IItemStore } from '@/core/items/ItemStore.types';
import type { IPushDeviceStore, NewPushDevice, PushDevice } from '@/core/push/PushDevice.types';
import type { IPushService, PushDeviceView } from './PushService.types';

// A new connection's first sync brings in old messages; those are not news.
const MAX_AGE_MS = 30 * 60 * 1000;
const PREVIEW_CHARS = 160;

export class PushService implements IPushService {
  private unsubscribe: Unsubscribe | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly deviceStore: IPushDeviceStore,
    private readonly client: IPushClient,
    private readonly itemStore: IItemStore,
    private readonly connectionStore: IConnectionStore,
    private readonly eventBus: IEventBus
  ) {}

  public publicKey(): string | null {
    return this.client.publicKey;
  }

  public async devices(): Promise<readonly PushDeviceView[]> {
    return (await this.deviceStore.list()).map((device) => PushService.toView(device));
  }

  public async register(device: NewPushDevice): Promise<PushDeviceView> {
    return PushService.toView(await this.deviceStore.save(device));
  }

  public async unregister(endpoint: string): Promise<void> {
    await this.deviceStore.removeByEndpoint(endpoint);
  }

  public async test(endpoint: string): Promise<boolean> {
    const device = (await this.deviceStore.list()).find((d) => d.endpoint === endpoint);

    if (!device) {
      return false;
    }

    return this.deliver([device], {
      title: 'Huginn',
      body: 'Notifications work. Only Important items will arrive here.',
      url: '/#inbox',
      tag: 'huginn-test',
      badge: await this.importantCount(),
    }).then((delivered) => delivered > 0);
  }

  public start(): void {
    this.unsubscribe ??= this.eventBus.subscribe((event) => {
      if (event.type === HuginnEventType.ItemUpserted && event.created && this.isNews(event.item)) {
        void this.notify(event.item).catch((error: unknown) =>
          this.logger.warn({ err: error, itemId: event.item.id }, 'push failed')
        );
      }
    });
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private isNews(item: Item): boolean {
    return (
      item.category === Category.Important &&
      item.state === ItemState.Open &&
      Date.now() - item.receivedAt.getTime() < MAX_AGE_MS
    );
  }

  private async notify(item: Item): Promise<void> {
    const devices = await this.deviceStore.list();

    if (devices.length === 0 || !this.client.publicKey) {
      return;
    }

    const connection = await this.connectionStore.get(item.connectionId);
    const preview = item.body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);

    await this.deliver(devices, {
      title: item.title,
      body: [`${item.author} · ${connection?.name ?? 'Huginn'}`, preview]
        .filter(Boolean)
        .join('\n'),
      url: '/#inbox',
      tag: `${item.connectionId}:${item.threadKey}`,
      badge: await this.importantCount(),
    });
  }

  /** Sends to every device in parallel, forgets the ones that are gone; returns how many got it. */
  private async deliver(devices: readonly PushDevice[], message: PushMessage): Promise<number> {
    const results = await Promise.all(
      devices.map(async (device) => {
        const result = await this.client.send(device, message);

        if (!result.ok) {
          this.logger.info({ deviceId: device.id, gone: result.gone }, 'push not delivered');

          if (result.gone) {
            await this.deviceStore.removeByEndpoint(device.endpoint);
          }
        }

        return result.ok;
      })
    );

    return results.filter(Boolean).length;
  }

  private async importantCount(): Promise<number> {
    return (
      await this.itemStore.list({
        state: ItemState.Open,
        category: Category.Important,
        limit: 999,
      })
    ).length;
  }

  private static toView(device: PushDevice): PushDeviceView {
    return {
      id: device.id,
      endpoint: device.endpoint,
      label: device.label,
      createdAt: device.createdAt,
    };
  }
}
