import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IActionStore } from '@/core/actions/ActionStore.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import type { IEventBus } from '@/core/events/EventBus.types';
import type { IItemStore } from '@/core/items/ItemStore.types';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IConnectionService } from '@/core/services/ConnectionService/ConnectionService.types';
import type { IConnectorHost } from '@/core/services/ConnectorHost/ConnectorHost.types';
import type { IInboxService } from '@/core/services/InboxService/InboxService.types';
import type { IFeedbackService } from '@/core/services/FeedbackService/FeedbackService.types';
import type { IOAuthAppService } from '@/core/services/OAuthAppService/OAuthAppService.types';
import type { IRuleService } from '@/core/services/RuleService/RuleService.types';
import type { ITriageService } from '@/core/services/TriageService/TriageService.types';

export interface Container {
  readonly logger: Logger;
  readonly config: IConfig;
  readonly eventBus: IEventBus;
  readonly secretBox: ISecretBox;
  readonly itemStore: IItemStore;
  readonly connectionStore: IConnectionStore;
  readonly actionStore: IActionStore;
  readonly connectorFactories: readonly IConnectorFactory[];
  readonly connectorHost: IConnectorHost;
  readonly inboxService: IInboxService;
  readonly connectionService: IConnectionService;
  readonly oauthAppService: IOAuthAppService;
  readonly triageService: ITriageService;
  readonly ruleService: IRuleService;
  readonly feedbackService: IFeedbackService;
  /** Releases the database handle; the host is stopped separately. */
  close(): void;
}
