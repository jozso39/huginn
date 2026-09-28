import type { IConnector } from '@/core/connectors/Connector.types';

/**
 * Runs one connector per enabled connection, restarts the ones that crash, and
 * is the only place that turns connector output into stored items and events.
 */
export interface IConnectorHost {
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  /** (Re)starts the connector of one connection after it was created or edited. */
  restart(connectionId: string): Promise<void>;
  stop(connectionId: string): Promise<void>;
  getConnector(connectionId: string): IConnector | null;
}
