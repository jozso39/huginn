import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IGmailClient } from '@/core/clients/GmailClient/GmailClient.types';
import type { IGoogleOAuthClient } from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { OAuthAppCredentials } from '@/core/oauth/OAuthApp.types';
import { GmailClient } from '@/infrastructure/clients/GmailClient/GmailClient';
import { GMAIL_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { GmailConnector } from './GmailConnector';
import { GmailInboxScope } from './GmailConnector.types';
import { GoogleAuthorization } from './GoogleAuthorization';

export const gmailConfigSchema = z.object({
  inboxScope: z
    .enum(GmailInboxScope)
    .default(GmailInboxScope.NoPromotions)
    .meta({
      title: 'Which mail',
      description: 'Unread inbox mail comes in. Accounts without inbox tabs get everything.',
      optionLabels: {
        [GmailInboxScope.PrimaryOnly]: 'Primary tab only',
        [GmailInboxScope.NoPromotions]: 'Everything except Promotions',
        [GmailInboxScope.AllInbox]: 'All inbox mail',
      },
    }),
});

export type GmailClientFactory = (app: OAuthAppCredentials, refreshToken: string) => IGmailClient;

/** Created by signing in with Google; the OAuth client is shared, set up once. */
export class GmailConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Gmail;
  public readonly label = 'Gmail';
  public readonly defaultRules = GMAIL_DEFAULT_RULES;
  public readonly capabilities = GmailConnector.capabilities;
  public readonly configSchema = gmailConfigSchema;
  public readonly secretFields: readonly SecretField[] = [];
  public readonly authorization: GoogleAuthorization;

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    oauth: IGoogleOAuthClient,
    private readonly createClient: GmailClientFactory = (app, refreshToken) =>
      new GmailClient(logger, oauth, { credentials: app, refreshToken, timeoutMs: 15_000 })
  ) {
    this.authorization = new GoogleAuthorization(oauth);
  }

  public create(
    connection: Connection,
    secrets: Secrets,
    app: OAuthAppCredentials | null
  ): IConnector {
    if (!app) {
      // The host checks this first; reaching here is a wiring bug, not a user error.
      throw new HuginnError(ErrorCode.Validation, 'Gmail needs the Google sign-in app');
    }

    return new GmailConnector(
      this.logger,
      connection,
      this.createClient(app, secrets.refreshToken ?? ''),
      gmailConfigSchema.parse(connection.config).inboxScope,
      this.config.connectors.gmailPollMs,
      this.config.maxBodyChars
    );
  }
}
