import type { Connection } from '@/core/connections/Connection.types';
import type { Item } from '@/core/items/Item.types';

export enum HuginnEventType {
  ItemUpserted = 'ItemUpserted',
  ItemChanged = 'ItemChanged',
  ConnectionChanged = 'ConnectionChanged',
}

export type HuginnEvent =
  | { readonly type: HuginnEventType.ItemUpserted; readonly item: Item; readonly created: boolean }
  | { readonly type: HuginnEventType.ItemChanged; readonly item: Item }
  | { readonly type: HuginnEventType.ConnectionChanged; readonly connection: Connection };

export type EventHandler = (event: HuginnEvent) => void;
export type Unsubscribe = () => void;

/** In-process pub/sub feeding the dashboard's SSE stream. */
export interface IEventBus {
  publish(event: HuginnEvent): void;
  subscribe(handler: EventHandler): Unsubscribe;
}
