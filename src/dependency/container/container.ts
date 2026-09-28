import { resolve } from 'node:path';
import type { IConfig } from '@/lib/config';
import { createConfig } from '@/lib/config';
import type { Logger } from '@/lib/logger';
import { createLogger } from '@/lib/logger';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import { ConnectionService } from '@/core/services/ConnectionService/ConnectionService';
import { ConnectorHost } from '@/core/services/ConnectorHost/ConnectorHost';
import { InboxService } from '@/core/services/InboxService/InboxService';
import { OAuthAppService } from '@/core/services/OAuthAppService/OAuthAppService';
import { GoogleOAuthClient } from '@/infrastructure/clients/GoogleOAuthClient/GoogleOAuthClient';
import { GitLabConnectorFactory } from '@/infrastructure/connectors/GitLabConnector/GitLabConnectorFactory';
import { GmailConnectorFactory } from '@/infrastructure/connectors/GmailConnector/GmailConnectorFactory';
import { IngestConnectorFactory } from '@/infrastructure/connectors/IngestConnector/IngestConnectorFactory';
import { SlackConnectorFactory } from '@/infrastructure/connectors/SlackConnector/SlackConnectorFactory';
import { SqliteDatabase } from '@/infrastructure/db/SqliteDatabase';
import { InMemoryEventBus } from '@/infrastructure/events/InMemoryEventBus/InMemoryEventBus';
import { AesSecretBox } from '@/infrastructure/secrets/AesSecretBox/AesSecretBox';
import { SqliteActionStore } from '@/infrastructure/stores/SqliteActionStore/SqliteActionStore';
import { SqliteConnectionStore } from '@/infrastructure/stores/SqliteConnectionStore/SqliteConnectionStore';
import { SqliteItemStore } from '@/infrastructure/stores/SqliteItemStore/SqliteItemStore';
import { SqliteOAuthAppStore } from '@/infrastructure/stores/SqliteOAuthAppStore/SqliteOAuthAppStore';
import type { Container } from './container.types';

export interface CreateContainerOptions {
  readonly config?: IConfig;
  readonly logger?: Logger;
  /** Replaces the default factory list wholesale (tests inject mocks here). */
  readonly connectorFactories?: readonly IConnectorFactory[];
}

const MIGRATIONS_FOLDER = resolve(import.meta.dir, '../../../drizzle');

export const createContainer = (options: CreateContainerOptions = {}): Container => {
  const config = options.config ?? createConfig();
  const logger = options.logger ?? createLogger(config);

  const database = new SqliteDatabase(logger, config.dbPath);

  database.migrate(MIGRATIONS_FOLDER);

  const eventBus = new InMemoryEventBus(logger);
  const secretBox = new AesSecretBox(config.secretKey);
  const itemStore = new SqliteItemStore(database.db);
  const connectionStore = new SqliteConnectionStore(database.db);
  const actionStore = new SqliteActionStore(database.db);
  const oauthAppService = new OAuthAppService(
    logger,
    new SqliteOAuthAppStore(database.db),
    secretBox,
    { publicUrl: config.publicUrl, relayUrl: config.oauthRelayUrl }
  );

  const connectorFactories: readonly IConnectorFactory[] = options.connectorFactories ?? [
    new GitLabConnectorFactory(logger, config),
    new SlackConnectorFactory(logger, config),
    new GmailConnectorFactory(logger, config, new GoogleOAuthClient(15_000)),
    new IngestConnectorFactory(),
  ];

  const connectorHost = new ConnectorHost(
    logger,
    config,
    connectorFactories,
    connectionStore,
    itemStore,
    secretBox,
    eventBus,
    oauthAppService
  );
  const inboxService = new InboxService(logger, itemStore, actionStore, connectorHost, eventBus);
  const connectionService = new ConnectionService(
    logger,
    connectorFactories,
    connectionStore,
    secretBox,
    connectorHost,
    oauthAppService,
    config.publicUrl
  );

  return {
    logger,
    config,
    eventBus,
    secretBox,
    itemStore,
    connectionStore,
    actionStore,
    connectorFactories,
    connectorHost,
    inboxService,
    connectionService,
    oauthAppService,
    close: () => database.close(),
  };
};
