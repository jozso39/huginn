import type { Connection } from '@/core/connections/Connection.types';
import type { Item } from '@/core/items/Item.types';
import type { AppInfo } from '@/core/updates/AppUpdate.types';

export enum HuginnEventType {
  ItemUpserted = 'ItemUpserted',
  ItemChanged = 'ItemChanged',
  ConnectionChanged = 'ConnectionChanged',
  /** Huginn's version or update status changed. */
  AppChanged = 'AppChanged',
}

export type HuginnEvent =
  | { readonly type: HuginnEventType.ItemUpserted; readonly item: Item; readonly created: boolean }
  | { readonly type: HuginnEventType.ItemChanged; readonly item: Item }
  | { readonly type: HuginnEventType.ConnectionChanged; readonly connection: Connection }
  | { readonly type: HuginnEventType.AppChanged; readonly app: AppInfo };

export type EventHandler = (event: HuginnEvent) => void;
export type Unsubscribe = () => void;

/** In-process pub/sub feeding the dashboard's SSE stream. */
export interface IEventBus {
  publish(event: HuginnEvent): void;
  subscribe(handler: EventHandler): Unsubscribe;
}
