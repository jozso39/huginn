import type { Logger } from '@/lib/logger';
import type { IAttentionSink } from '@/core/attention/Attention.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type { IEventBus, Unsubscribe } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import type { Item } from '@/core/items/Item.types';
import { Category, ItemState } from '@/core/items/Item.types';
import type { IItemStore } from '@/core/items/ItemStore.types';
import { toError } from '@/core/errors/errors';
import type { IAttentionService } from './AttentionService.types';

// A new connection's first sync brings in old messages; those are not news.
const MAX_AGE_MS = 30 * 60 * 1000;
const PREVIEW_CHARS = 160;
// A sync can change dozens of items at once; count once they settle.
const BADGE_DELAY_MS = 300;

export class AttentionService implements IAttentionService {
  private unsubscribe: Unsubscribe | null = null;
  private badgeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBadge: number | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly sink: IAttentionSink,
    private readonly itemStore: IItemStore,
    private readonly connectionStore: IConnectionStore,
    private readonly eventBus: IEventBus
  ) {}

  public async start(): Promise<void> {
    this.unsubscribe ??= this.eventBus.subscribe((event) => {
      if (event.type === HuginnEventType.ConnectionChanged) {
        return;
      }

      this.scheduleBadge();

      if (event.type === HuginnEventType.ItemUpserted && event.created && this.isNews(event.item)) {
        void this.notify(event.item).catch((error: unknown) =>
          this.logger.warn({ err: toError(error), itemId: event.item.id }, 'notice failed')
        );
      }
    });
    await this.updateBadge();
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.badgeTimer) {
      clearTimeout(this.badgeTimer);
      this.badgeTimer = null;
    }
  }

  private isNews(item: Item): boolean {
    return (
      item.category === Category.Important &&
      item.state === ItemState.Open &&
      Date.now() - item.receivedAt.getTime() < MAX_AGE_MS
    );
  }

  private async notify(item: Item): Promise<void> {
    const connection = await this.connectionStore.get(item.connectionId);
    const preview = item.body.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);

    this.sink.notify({
      itemId: item.id,
      title: item.title,
      body: [`${item.author} · ${connection?.name ?? 'Huginn'}`, preview]
        .filter((part) => part !== '')
        .join('\n'),
    });
  }

  private scheduleBadge(): void {
    if (this.badgeTimer) {
      return;
    }

    this.badgeTimer = setTimeout(() => {
      this.badgeTimer = null;
      void this.updateBadge().catch((error: unknown) =>
        this.logger.warn({ err: toError(error) }, 'badge update failed')
      );
    }, BADGE_DELAY_MS);
  }

  private async updateBadge(): Promise<void> {
    const important = (
      await this.itemStore.list({ state: ItemState.Open, category: Category.Important, limit: 999 })
    ).length;

    if (important !== this.lastBadge) {
      this.lastBadge = important;
      this.sink.badge(important);
    }
  }
}
