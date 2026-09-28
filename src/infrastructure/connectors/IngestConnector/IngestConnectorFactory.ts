import { z } from 'zod';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory } from '@/core/connectors/Connector.types';

/**
 * A connection with no poller. Items for it arrive through POST /api/items —
 * Hermes, cron scripts, anything holding the ingest key. It exists so those
 * items have a connection to belong to and can be filtered like the others.
 */
class IngestConnector implements IConnector {
  public readonly kind = ConnectorKind.Ingest;
  public readonly capabilities = { reply: false, react: false, ack: false };

  public start(): Promise<void> {
    return Promise.resolve();
  }

  public stop(): Promise<void> {
    return Promise.resolve();
  }
}

export class IngestConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Ingest;
  public readonly label = 'Ingest (API)';
  public readonly configSchema = z.object({});
  public readonly secretFields = [];

  public create(_connection: Connection, _secrets: Secrets): IConnector {
    return new IngestConnector();
  }
}
