import type { TriageDecision } from '@/core/triage/Rule.types';
import type { Category, Item, ItemState, NewItem } from './Item.types';

export interface ItemFilter {
  readonly state?: ItemState;
  readonly category?: Category;
  readonly connectionId?: string;
  readonly limit?: number;
}

export interface UpsertResult {
  readonly item: Item;
  /** False when the external id was already known and only got refreshed. */
  readonly created: boolean;
}

export interface IItemStore {
  upsert(item: NewItem): Promise<UpsertResult>;
  get(id: string): Promise<Item | null>;
  list(filter: ItemFilter): Promise<readonly Item[]>;
  setState(id: string, state: ItemState): Promise<Item | null>;
  setDecision(id: string, decision: TriageDecision): Promise<Item | null>;
  /**
   * Closes every Open item of the connection whose external id is not in the
   * list. Connectors call this after a full poll so a todo finished in GitLab
   * disappears here too, without a second query per item.
   */
  closeOpenExcept(
    connectionId: string,
    keepExternalIds: readonly string[]
  ): Promise<readonly Item[]>;
  /** Closes every Open item of one conversation, e.g. after the user answered it at the source. */
  closeThread(connectionId: string, threadKey: string): Promise<readonly Item[]>;
  closeByExternalIds(
    connectionId: string,
    externalIds: readonly string[]
  ): Promise<readonly Item[]>;
}
