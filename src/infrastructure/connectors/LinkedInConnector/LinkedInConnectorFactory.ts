import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IGoogleOAuthClient } from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { OAuthAppCredentials } from '@/core/oauth/OAuthApp.types';
import { GmailClient } from '@/infrastructure/clients/GmailClient/GmailClient';
import { LINKEDIN_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { pollIntervalField, pollMs } from '@/infrastructure/connectors/pollInterval';
import { GmailConnector } from '@/infrastructure/connectors/GmailConnector/GmailConnector';
import type { GmailClientFactory } from '@/infrastructure/connectors/GmailConnector/GmailConnectorFactory';
import { GoogleAuthorization } from '@/infrastructure/connectors/GmailConnector/GoogleAuthorization';
import { LINKEDIN_CAPABILITIES, linkedInMailSource } from './LinkedInConnector.utils';

export const linkedInConfigSchema = z.object({ checkEvery: pollIntervalField });

/**
 * LinkedIn through the mails it sends: sign in with the Google account LinkedIn
 * notifies, and its messages, invitations and mentions come in. The same mailbox's
 * Gmail connection can leave those mails out ("Leave out mail from: linkedin.com").
 */
export class LinkedInConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.LinkedIn;
  public readonly label = 'LinkedIn (via Gmail)';
  public readonly defaultRules = LINKEDIN_DEFAULT_RULES;
  public readonly capabilities = LINKEDIN_CAPABILITIES;
  public readonly configSchema = linkedInConfigSchema;
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
      throw new HuginnError(ErrorCode.Validation, 'LinkedIn needs the Google sign-in app');
    }

    return new GmailConnector(
      this.logger,
      connection,
      this.createClient(app, secrets.refreshToken ?? ''),
      linkedInMailSource(),
      pollMs(
        linkedInConfigSchema.parse(connection.config).checkEvery,
        this.config.connectors.pollOverrideMs
      ),
      this.config.maxBodyChars
    );
  }
}
