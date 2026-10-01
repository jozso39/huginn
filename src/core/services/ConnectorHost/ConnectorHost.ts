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
import type { Item, NewItem } from '@/core/items/Item.types';
import { ItemState } from '@/core/items/Item.types';
import type { IItemStore, UpsertResult } from '@/core/items/ItemStore.types';
import type { OAuthAppCredentials } from '@/core/oauth/OAuthApp.types';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IOAuthAppService } from '@/core/services/OAuthAppService/OAuthAppService.types';
import type { ITriageService } from '@/core/services/TriageService/TriageService.types';
import type { IConnectorHost } from './ConnectorHost.types';

interface RunningConnector {
  readonly connector: IConnector;
  readonly generation: number;
}

/** How often a push connector's "heard from the source" is written down. */
const SYNC_MARK_INTERVAL_MS = 10_000;

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
    private readonly eventBus: IEventBus,
    private readonly oauthApps: IOAuthAppService,
    private readonly triage: ITriageService
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

    const secrets = await this.loadSecrets(connection.id).catch((error: unknown) => {
      // One unreadable connection must not take the others (or the server) down.
      this.logger.error({ connectionId: connection.id, err: toError(error) }, 'secrets unreadable');

      return null;
    });

    if (!secrets) {
      await this.setStatus(
        connection.id,
        ConnectionStatus.Error,
        'Its stored tokens cannot be decrypted (was HUGINN_SECRET_KEY changed?) — enter them again'
      );

      return;
    }

    const authorization = factory.authorization;
    const app: OAuthAppCredentials | null = authorization
      ? await this.oauthApps.credentials(authorization.provider)
      : null;

    // Not an error and not worth retrying: it waits for the user.
    if (authorization && !app) {
      await this.setStatus(
        connection.id,
        ConnectionStatus.NeedsAuth,
        `Set up ${authorization.provider} sign-in first`
      );

      return;
    }

    if (authorization && !authorization.isAuthorized(secrets)) {
      await this.setStatus(connection.id, ConnectionStatus.NeedsAuth, 'Sign in to start');

      return;
    }

    if (factory.pairing && !factory.pairing.isPaired(secrets)) {
      await this.setStatus(connection.id, ConnectionStatus.NeedsAuth, 'Link your phone to start');

      return;
    }

    const connector = factory.create(connection, secrets, app);
    const generation = ++this.generation;

    this.running.set(connection.id, { connector, generation });
    // Idle while starting, so anything the connector reports during start() (a
    // warning about its settings, say) is still there afterwards.
    await this.setStatus(connection.id, ConnectionStatus.Idle, null);

    try {
      await connector.start(this.contextFor(connection, secrets));
      this.failures.delete(connection.id);

      const reported = await this.connectionStore.get(connection.id);

      // Still Idle means the connector said nothing; anything else it reported
      // (a warning, a request to sign in again) is the truth and stays.
      if (reported?.status === ConnectionStatus.Idle) {
        await this.setStatus(connection.id, ConnectionStatus.Running, null);
      }
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
    // A busy Slack delivers several events a second; the time shown is in minutes.
    let syncedAt = 0;

    return {
      connection,
      secrets,
      upsert: (item: NewItem): Promise<UpsertResult> => this.upsert(item),
      closeOpenExcept: async (keepExternalIds): Promise<void> => {
        this.announceChanged(await this.itemStore.closeOpenExcept(connection.id, keepExternalIds));
      },
      closeThread: async (threadKey): Promise<void> => {
        this.announceChanged(await this.itemStore.closeThread(connection.id, threadKey));
      },
      closeItems: async (externalIds): Promise<void> => {
        this.announceChanged(await this.itemStore.closeByExternalIds(connection.id, externalIds));
      },
      openItems: async () =>
        (
          await this.itemStore.list({
            connectionId: connection.id,
            state: ItemState.Open,
            limit: 500,
          })
        ).map((item) => ({ externalId: item.externalId, threadKey: item.threadKey })),
      markSynced: async (): Promise<void> => {
        const now = Date.now();

        if (now - syncedAt < SYNC_MARK_INTERVAL_MS) {
          return;
        }

        syncedAt = now;
        await this.connectionStore.update(connection.id, { lastSyncAt: new Date(now) });
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

  private announceChanged(items: readonly Item[]): void {
    items.forEach((item) => this.eventBus.publish({ type: HuginnEventType.ItemChanged, item }));
  }

  private async upsert(item: NewItem): Promise<UpsertResult> {
    const stored = await this.itemStore.upsert(item);
    // New items are sorted before anyone sees them; a refreshed one keeps its place.
    const result = stored.created
      ? { ...stored, item: await this.triageSafely(stored.item) }
      : stored;

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

  /** Triage must never cost an item: on failure it simply stays Undecided. */
  private async triageSafely(item: Item): Promise<Item> {
    try {
      return await this.triage.triage(item);
    } catch (error) {
      this.logger.warn({ err: toError(error), itemId: item.id }, 'triage failed');

      return item;
    }
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
