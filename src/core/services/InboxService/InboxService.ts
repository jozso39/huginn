import type { Logger } from '@/lib/logger';
import { ActionType } from '@/core/actions/Action.types';
import type { IActionStore } from '@/core/actions/ActionStore.types';
import type { ActionResult, IConnector } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { IEventBus } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import type { Item, NewItem } from '@/core/items/Item.types';
import { ItemState } from '@/core/items/Item.types';
import type { IItemStore } from '@/core/items/ItemStore.types';
import type { IConnectorHost } from '@/core/services/ConnectorHost/ConnectorHost.types';
import type { IInboxService, InboxFilter, ItemWithActions } from './InboxService.types';

export class InboxService implements IInboxService {
  constructor(
    private readonly logger: Logger,
    private readonly itemStore: IItemStore,
    private readonly actionStore: IActionStore,
    private readonly connectorHost: IConnectorHost,
    private readonly eventBus: IEventBus
  ) {}

  public list(filter: InboxFilter): Promise<readonly Item[]> {
    return this.itemStore.list(filter);
  }

  public async get(id: string): Promise<ItemWithActions | null> {
    const item = await this.itemStore.get(id);

    if (!item) {
      return null;
    }

    return { item, actions: await this.actionStore.listForItem(id) };
  }

  public async ingest(newItem: NewItem): Promise<Item> {
    const { item, created } = await this.itemStore.upsert(newItem);

    this.eventBus.publish({ type: HuginnEventType.ItemUpserted, item, created });

    return item;
  }

  public async reply(id: string, text: string): Promise<Item> {
    const item = await this.require(id);
    const connector = this.connectorFor(item, 'reply');

    if (!connector.reply) {
      throw new HuginnError(ErrorCode.Unsupported, 'this connection cannot reply');
    }

    const result = await connector.reply(item, text);

    await this.record(item, ActionType.Reply, { text }, result);
    this.assertOk(result, 'reply');

    // Replying is dealing with it: the item leaves the open list. A follow-up
    // from the other side arrives as a new item in the same thread.
    return this.transition(item, ItemState.Done);
  }

  public async draft(id: string, text: string): Promise<Item> {
    const item = await this.require(id);
    const connector = this.connectorFor(item, 'draft');

    if (!connector.draft) {
      throw new HuginnError(ErrorCode.Unsupported, 'this connection cannot save drafts');
    }

    const result = await connector.draft(item, text);

    await this.record(item, ActionType.Draft, { text }, result);
    this.assertOk(result, 'draft');

    return item;
  }

  public async react(id: string, emoji: string): Promise<Item> {
    const item = await this.require(id);
    const connector = this.connectorFor(item, 'react');

    if (!connector.react) {
      throw new HuginnError(ErrorCode.Unsupported, 'this connection cannot react');
    }

    const result = await connector.react(item, emoji);

    await this.record(item, ActionType.React, { emoji }, result);
    this.assertOk(result, 'react');

    return item;
  }

  public async done(id: string): Promise<Item> {
    const item = await this.require(id);
    const connector = this.connectorHost.getConnector(item.connectionId);

    // Ack at the provider is best effort: a GitLab todo we cannot close still
    // leaves the dashboard, because the user said so.
    const result = connector?.ack ? await connector.ack(item) : null;

    if (result && !result.ok) {
      this.logger.warn({ itemId: id, error: result.error }, 'provider ack failed');
    }

    await this.record(item, ActionType.Done, {}, result);

    return this.transition(item, ItemState.Done);
  }

  public async reopen(id: string): Promise<Item> {
    const item = await this.require(id);

    return this.transition(item, ItemState.Open);
  }

  private async require(id: string): Promise<Item> {
    const item = await this.itemStore.get(id);

    if (!item) {
      throw new HuginnError(ErrorCode.NotFound, `item ${id} not found`);
    }

    return item;
  }

  private connectorFor(item: Item, capability: 'reply' | 'draft' | 'react'): IConnector {
    const connector = this.connectorHost.getConnector(item.connectionId);

    if (!connector) {
      throw new HuginnError(ErrorCode.Unsupported, 'connection is not running');
    }

    if (!connector.capabilities[capability]) {
      throw new HuginnError(ErrorCode.Unsupported, `${connector.kind} cannot ${capability}`);
    }

    return connector;
  }

  private assertOk(result: ActionResult, what: string): void {
    if (!result.ok) {
      throw new HuginnError(ErrorCode.Upstream, result.error ?? `${what} failed`);
    }
  }

  private async record(
    item: Item,
    type: ActionType,
    payload: Record<string, unknown>,
    result: ActionResult | null
  ): Promise<void> {
    await this.actionStore.append({
      itemId: item.id,
      type,
      payload,
      result: result ? { ...result } : null,
    });
  }

  private async transition(item: Item, state: ItemState): Promise<Item> {
    const updated = (await this.itemStore.setState(item.id, state)) ?? item;

    this.eventBus.publish({ type: HuginnEventType.ItemChanged, item: updated });

    return updated;
  }
}
