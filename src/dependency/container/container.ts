import type { IConfig } from '@/lib/config';
import { createConfig } from '@/lib/config';
import type { Logger } from '@/lib/logger';
import { createLogger } from '@/lib/logger';
import type { IJevClient } from '@/core/clients/JevClient/JevClient.types';
import type { ILlmClient } from '@/core/clients/LlmClient/LlmClient.types';
import type { IAttentionSink } from '@/core/attention/Attention.types';
import type { IPushClient } from '@/core/clients/PushClient/PushClient.types';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import { AttentionService } from '@/core/services/AttentionService/AttentionService';
import { ConnectionService } from '@/core/services/ConnectionService/ConnectionService';
import { ConnectorHost } from '@/core/services/ConnectorHost/ConnectorHost';
import { FeedbackService } from '@/core/services/FeedbackService/FeedbackService';
import { InboxService } from '@/core/services/InboxService/InboxService';
import { OAuthAppService } from '@/core/services/OAuthAppService/OAuthAppService';
import { PushService } from '@/core/services/PushService/PushService';
import { RuleService } from '@/core/services/RuleService/RuleService';
import { TriageService } from '@/core/services/TriageService/TriageService';
import { GoogleOAuthClient } from '@/infrastructure/clients/GoogleOAuthClient/GoogleOAuthClient';
import { JevClient } from '@/infrastructure/clients/JevClient/JevClient';
import { OpenRouterLlmClient } from '@/infrastructure/clients/OpenRouterLlmClient/OpenRouterLlmClient';
import { WebPushClient } from '@/infrastructure/clients/WebPushClient/WebPushClient';
import { ClickUpConnectorFactory } from '@/infrastructure/connectors/ClickUpConnector/ClickUpConnectorFactory';
import { GitLabConnectorFactory } from '@/infrastructure/connectors/GitLabConnector/GitLabConnectorFactory';
import { GmailConnectorFactory } from '@/infrastructure/connectors/GmailConnector/GmailConnectorFactory';
import { IngestConnectorFactory } from '@/infrastructure/connectors/IngestConnector/IngestConnectorFactory';
import { LinkedInConnectorFactory } from '@/infrastructure/connectors/LinkedInConnector/LinkedInConnectorFactory';
import { SignalConnectorFactory } from '@/infrastructure/connectors/SignalConnector/SignalConnectorFactory';
import { SlackConnectorFactory } from '@/infrastructure/connectors/SlackConnector/SlackConnectorFactory';
import { SqliteDatabase } from '@/infrastructure/db/SqliteDatabase';
import { InMemoryEventBus } from '@/infrastructure/events/InMemoryEventBus/InMemoryEventBus';
import { AesSecretBox } from '@/infrastructure/secrets/AesSecretBox/AesSecretBox';
import { SqliteActionStore } from '@/infrastructure/stores/SqliteActionStore/SqliteActionStore';
import { SqliteConnectionStore } from '@/infrastructure/stores/SqliteConnectionStore/SqliteConnectionStore';
import { SqliteItemStore } from '@/infrastructure/stores/SqliteItemStore/SqliteItemStore';
import { SqliteOAuthAppStore } from '@/infrastructure/stores/SqliteOAuthAppStore/SqliteOAuthAppStore';
import { SqlitePushDeviceStore } from '@/infrastructure/stores/SqlitePushDeviceStore/SqlitePushDeviceStore';
import { SqliteRuleStore } from '@/infrastructure/stores/SqliteRuleStore/SqliteRuleStore';
import type { Container } from './container.types';

export interface CreateContainerOptions {
  readonly config?: IConfig;
  readonly logger?: Logger;
  /** Replaces the default factory list wholesale (tests inject mocks here). */
  readonly connectorFactories?: readonly IConnectorFactory[];
  readonly jev?: IJevClient;
  readonly llm?: ILlmClient;
  readonly push?: IPushClient;
  /** The Mac app's menu bar and notifications; nowhere when running without it. */
  readonly attentionSink?: IAttentionSink;
}

const NO_ATTENTION: IAttentionSink = { badge: () => undefined, notify: () => undefined };

export const createContainer = (options: CreateContainerOptions = {}): Container => {
  const config = options.config ?? createConfig();
  const logger = options.logger ?? createLogger(config);

  const database = new SqliteDatabase(logger, config.dbPath);

  database.migrate(config.paths.migrations);

  const eventBus = new InMemoryEventBus(logger);
  const secretBox = new AesSecretBox(config.secretKey);
  const itemStore = new SqliteItemStore(database.db);
  const connectionStore = new SqliteConnectionStore(database.db);
  const actionStore = new SqliteActionStore(database.db);
  const ruleStore = new SqliteRuleStore(database.db);
  const oauthAppService = new OAuthAppService(
    logger,
    new SqliteOAuthAppStore(database.db),
    secretBox,
    { publicUrl: config.publicUrl, relayUrl: config.oauthRelayUrl }
  );
  const jev =
    options.jev ??
    new JevClient(logger, {
      apiKey: config.ai.openRouterApiKey,
      model: config.ai.jevModel,
      timeoutMs: config.ai.jevTimeoutMs,
    });
  const llm =
    options.llm ??
    new OpenRouterLlmClient(logger, {
      apiKey: config.ai.openRouterApiKey,
      model: config.ai.feedbackModel,
      timeoutMs: config.ai.feedbackTimeoutMs,
    });

  const googleOAuth = new GoogleOAuthClient(15_000);
  const connectorFactories: readonly IConnectorFactory[] = options.connectorFactories ?? [
    new GitLabConnectorFactory(logger, config),
    new SlackConnectorFactory(logger, config),
    new GmailConnectorFactory(logger, config, googleOAuth),
    new LinkedInConnectorFactory(logger, config, googleOAuth),
    new ClickUpConnectorFactory(logger, config),
    new SignalConnectorFactory(logger, config),
    new IngestConnectorFactory(),
  ];

  const triageService = new TriageService(
    logger,
    ruleStore,
    itemStore,
    connectionStore,
    jev,
    eventBus
  );
  const ruleService = new RuleService(
    logger,
    ruleStore,
    triageService,
    itemStore,
    connectionStore,
    connectorFactories
  );
  const connectorHost = new ConnectorHost(
    logger,
    config,
    connectorFactories,
    connectionStore,
    itemStore,
    secretBox,
    eventBus,
    oauthAppService,
    triageService
  );
  const inboxService = new InboxService(
    logger,
    itemStore,
    actionStore,
    connectorHost,
    eventBus,
    triageService
  );
  const connectionService = new ConnectionService(
    logger,
    connectorFactories,
    connectionStore,
    secretBox,
    connectorHost,
    oauthAppService,
    ruleService,
    config.publicUrl
  );
  const feedbackService = new FeedbackService(
    logger,
    itemStore,
    actionStore,
    connectionStore,
    ruleService,
    triageService,
    jev,
    llm,
    eventBus
  );
  const pushService = new PushService(
    logger,
    new SqlitePushDeviceStore(database.db),
    options.push ?? new WebPushClient(logger, config.vapid),
    itemStore,
    connectionStore,
    eventBus
  );

  const attentionService = new AttentionService(
    logger,
    options.attentionSink ?? NO_ATTENTION,
    itemStore,
    connectionStore,
    eventBus
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
    triageService,
    ruleService,
    feedbackService,
    pushService,
    attentionService,
    close: () => database.close(),
  };
};
