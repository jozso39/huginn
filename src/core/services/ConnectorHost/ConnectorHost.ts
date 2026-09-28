import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { Connection, ConnectionCursor, Secrets } from '@/core/connections/Connection.types';
import { ConnectionStatus } from '@/core/connections/Connection.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type {
  ConnectorContext,
  IConnector,
  IConnectorFactory,
} from '@/core/connectors/Connector.types';
import { toError } from '@/core/errors/errors';
import type { IEventBus } from '@/core/events/EventBus.types';
import { HuginnEventType } from '@/core/events/EventBus.types';
import type { NewItem } from '@/core/items/Item.types';
import { ItemState } from '@/core/items/Item.types';
import type { IItemStore, UpsertResult } from '@/core/items/ItemStore.types';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IConnectorHost } from './ConnectorHost.types';

interface RunningConnector {
  readonly connector: IConnector;
  readonly generation: number;
}

export class ConnectorHost implements IConnectorHost {
  private readonly running = new Map<string, RunningConnector>();
  private readonly failures = new Map<string, number>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private generation = 0;

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    private readonly factories: readonly IConnectorFactory[],
    private readonly connectionStore: IConnectionStore,
    private readonly itemStore: IItemStore,
    private readonly secretBox: ISecretBox,
    private readonly eventBus: IEventBus
  ) {}

  public async startAll(): Promise<void> {
    const connections = await this.connectionStore.list();

    await Promise.all(connections.map((connection) => this.launch(connection)));
  }

  public async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }

  public async restart(connectionId: string): Promise<void> {
    await this.stop(connectionId);

    const connection = await this.connectionStore.get(connectionId);

    if (connection) {
      await this.launch(connection);
    }
  }

  public async stop(connectionId: string): Promise<void> {
    const timer = this.retryTimers.get(connectionId);

    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(connectionId);
    }

    const entry = this.running.get(connectionId);

    if (!entry) {
      return;
    }

    this.running.delete(connectionId);

    try {
      await entry.connector.stop();
    } catch (error) {
      this.logger.warn({ connectionId, err: toError(error) }, 'connector stop failed');
    }
  }

  public getConnector(connectionId: string): IConnector | null {
    return this.running.get(connectionId)?.connector ?? null;
  }

  private async launch(connection: Connection): Promise<void> {
    if (!connection.enabled) {
      await this.setStatus(connection.id, ConnectionStatus.Disabled, null);

      return;
    }

    const factory = this.factories.find((candidate) => candidate.kind === connection.kind);

    if (!factory) {
      await this.setStatus(
        connection.id,
        ConnectionStatus.Error,
        `no connector for ${connection.kind}`
      );

      return;
    }

    const secrets = await this.loadSecrets(connection.id);
    const connector = factory.create(connection, secrets);
    const generation = ++this.generation;

    this.running.set(connection.id, { connector, generation });

    try {
      await connector.start(this.contextFor(connection, secrets));
      this.failures.delete(connection.id);
      await this.setStatus(connection.id, ConnectionStatus.Running, null);
    } catch (error) {
      // A start failure is usually a bad token or the provider being down. Both
      // deserve a retry, but with a growing gap so we never look like abuse.
      const err = toError(error);
      const attempt = (this.failures.get(connection.id) ?? 0) + 1;
      const backoffs = this.config.connectors.restartBackoffMs;
      const delay = backoffs[Math.min(attempt, backoffs.length) - 1] ?? 600_000;

      this.failures.set(connection.id, attempt);
      this.running.delete(connection.id);
      this.logger.error({ connectionId: connection.id, attempt, delay, err }, 'connector failed');
      await this.setStatus(connection.id, ConnectionStatus.Error, err.message);

      const timer = setTimeout(() => {
        this.retryTimers.delete(connection.id);
        // Only retry if nobody restarted or stopped us in the meantime.
        const current = this.running.get(connection.id);

        if (!current || current.generation === generation) {
          void this.restart(connection.id);
        }
      }, delay);

      this.retryTimers.set(connection.id, timer);
    }
  }

  private contextFor(connection: Connection, secrets: Secrets): ConnectorContext {
    // The cursor is read through a closure so a connector always sees what it
    // last wrote, without a round trip to the store on every poll.
    let cursor: ConnectionCursor = connection.cursor;

    return {
      connection,
      secrets,
      upsert: (item: NewItem): Promise<UpsertResult> => this.upsert(item),
      closeOpenExcept: async (keepExternalIds): Promise<void> => {
        const closed = await this.itemStore.closeOpenExcept(connection.id, keepExternalIds);

        closed.forEach((item) =>
          this.eventBus.publish({ type: HuginnEventType.ItemChanged, item })
        );
      },
      getCursor: (): ConnectionCursor => cursor,
      setCursor: async (next: ConnectionCursor): Promise<void> => {
        cursor = next;
        await this.connectionStore.update(connection.id, { cursor: next, lastSyncAt: new Date() });
      },
      report: (status, message): Promise<void> =>
        this.setStatus(connection.id, status, message ?? null),
    };
  }

  private async upsert(item: NewItem): Promise<UpsertResult> {
    const result = await this.itemStore.upsert(item);

    // A refreshed copy of an item the user already closed is not news.
    if (result.created || result.item.state === ItemState.Open) {
      this.eventBus.publish({
        type: HuginnEventType.ItemUpserted,
        item: result.item,
        created: result.created,
      });
    }

    return result;
  }

  private async loadSecrets(connectionId: string): Promise<Secrets> {
    const ciphertext = await this.connectionStore.getSecretsCiphertext(connectionId);

    if (!ciphertext) {
      return {};
    }

    return JSON.parse(await this.secretBox.open(ciphertext)) as Secrets;
  }

  private async setStatus(
    connectionId: string,
    status: ConnectionStatus,
    statusMessage: string | null
  ): Promise<void> {
    const connection = await this.connectionStore.update(connectionId, { status, statusMessage });

    if (connection) {
      this.eventBus.publish({ type: HuginnEventType.ConnectionChanged, connection });
    }
  }
}
