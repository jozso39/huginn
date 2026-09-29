import type { Action } from '@/core/actions/Action.types';
import type { Category, Item, ItemState, NewItem, RichContent } from '@/core/items/Item.types';

export interface InboxFilter {
  readonly state?: ItemState;
  readonly category?: Category;
  readonly connectionId?: string;
  readonly limit?: number;
}

export interface ItemWithActions {
  readonly item: Item;
  readonly actions: readonly Action[];
}

/** What the dashboard does with an item. Every call is written to the archive. */
export interface IInboxService {
  list(filter: InboxFilter): Promise<readonly Item[]>;
  get(id: string): Promise<ItemWithActions | null>;
  /** How to show the whole message: stored rich form, fetched from the source, or the text. */
  content(id: string): Promise<RichContent>;
  /** External writers (Hermes, scripts) push straight into the inbox. */
  ingest(item: NewItem): Promise<Item>;
  reply(id: string, text: string): Promise<Item>;
  /** Saves the reply as a draft at the source; the item stays open until it is sent. */
  draft(id: string, text: string): Promise<Item>;
  react(id: string, emoji: string): Promise<Item>;
  /** Hide/done/ack: closes here and, when the connector can, at the provider. */
  done(id: string): Promise<Item>;
  reopen(id: string): Promise<Item>;
}
