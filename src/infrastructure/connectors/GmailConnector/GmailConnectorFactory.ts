import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IGmailClient } from '@/core/clients/GmailClient/GmailClient.types';
import type { IGoogleOAuthClient } from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import { GmailClient } from '@/infrastructure/clients/GmailClient/GmailClient';
import { GmailConnector } from './GmailConnector';
import { GmailInboxScope, GoogleClientType } from './GmailConnector.types';
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
  clientType: z
    .enum(GoogleClientType)
    .default(GoogleClientType.Desktop)
    .meta({
      title: 'Google OAuth client type',
      description: 'The type of the client ID below, as shown in Google Cloud → Credentials.',
      optionLabels: {
        [GoogleClientType.Desktop]: 'Desktop app — paste the address back after signing in',
        [GoogleClientType.Web]: 'Web application — returns to Huginn by itself',
      },
    }),
});

export type GmailClientFactory = (secrets: Secrets) => IGmailClient;

export class GmailConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Gmail;
  public readonly label = 'Gmail';
  public readonly capabilities = GmailConnector.capabilities;
  public readonly configSchema = gmailConfigSchema;
  public readonly secretFields: readonly SecretField[] = [
    {
      key: 'clientId',
      label: 'OAuth client ID',
      hint: 'Google Cloud → APIs & Services → Credentials. One client can serve several mailboxes.',
    },
    { key: 'clientSecret', label: 'OAuth client secret' },
  ];
  public readonly authorization: GoogleAuthorization;

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    oauth: IGoogleOAuthClient,
    private readonly createClient: GmailClientFactory = (secrets) =>
      new GmailClient(logger, oauth, {
        credentials: { clientId: secrets.clientId ?? '', clientSecret: secrets.clientSecret ?? '' },
        refreshToken: secrets.refreshToken ?? '',
        timeoutMs: 15_000,
      })
  ) {
    this.authorization = new GoogleAuthorization(oauth, config.publicUrl);
  }

  public create(connection: Connection, secrets: Secrets): IConnector {
    const parsed = gmailConfigSchema.parse(connection.config);

    return new GmailConnector(
      this.logger,
      connection,
      this.createClient(secrets),
      parsed.inboxScope,
      this.config.connectors.gmailPollMs,
      this.config.maxBodyChars
    );
  }
}
