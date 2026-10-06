import { z } from 'zod';
import type { Connection, ConnectorKind } from '@/core/connections/Connection.types';
import type { Item, NewItem } from '@/core/items/Item.types';
import type {
  ConnectorCapabilities,
  ConnectorContext,
  IConnector,
  IConnectorFactory,
  SecretField,
} from './Connector.types';

const NOTHING: ConnectorCapabilities = { reply: false, draft: false, react: false, ack: false };

/**
 * A source a test feeds by hand, standing in for any kind: no poller and no default
 * rules, so each test adds the rules it needs. `deliver` sends a message the way a
 * real connector does (stored, sorted by triage, announced), through the host.
 */
export class MockConnectorFactory implements IConnectorFactory {
  public readonly label = 'Test source';
  public readonly capabilities = NOTHING;
  public readonly configSchema = z.object({});
  public readonly secretFields: readonly SecretField[] = [];
  private readonly running = new Map<string, ConnectorContext>();

  constructor(public readonly kind: ConnectorKind) {}

  public create(connection: Connection): IConnector {
    return {
      kind: this.kind,
      capabilities: NOTHING,
      start: (ctx) => {
        this.running.set(connection.id, ctx);

        return Promise.resolve();
      },
      stop: () => {
        this.running.delete(connection.id);

        return Promise.resolve();
      },
    };
  }

  public async deliver(item: NewItem): Promise<Item> {
    const ctx = this.running.get(item.connectionId);

    if (!ctx) {
      throw new Error(`connection ${item.connectionId} is not running`);
    }

    return (await ctx.upsert(item)).item;
  }
}
