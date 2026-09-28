import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { ISlackClient } from '@/core/clients/SlackClient/SlackClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import { SlackClient } from '@/infrastructure/clients/SlackClient/SlackClient';
import { SlackConnector } from './SlackConnector';

export const slackConfigSchema = z.object({
  watchChannels: z.string().default('').meta({
    title: 'Also watch channels',
    description: 'Channel IDs, comma-separated (optional) — every message there comes in',
  }),
});

export type SlackClientFactory = (userToken: string, appToken: string) => ISlackClient;

export class SlackConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Slack;
  public readonly label = 'Slack';
  public readonly configSchema = slackConfigSchema;
  public readonly secretFields: readonly SecretField[] = [
    {
      key: 'userToken',
      label: 'User OAuth token (xoxp-…)',
      hint: 'OAuth & Permissions → User OAuth Token. Reads and replies as you.',
    },
    {
      key: 'appToken',
      label: 'App-level token (xapp-…)',
      hint: 'Basic Information → App-Level Tokens, scope connections:write. Opens Socket Mode.',
    },
  ];

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    private readonly createClient: SlackClientFactory = (userToken, appToken) =>
      new SlackClient(logger, { userToken, appToken })
  ) {}

  public create(connection: Connection, secrets: Secrets): IConnector {
    const { watchChannels } = slackConfigSchema.parse(connection.config);
    const watched = new Set(
      watchChannels
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '')
    );

    return new SlackConnector(
      this.logger,
      connection,
      this.createClient(secrets.userToken ?? '', secrets.appToken ?? ''),
      watched,
      this.config.maxBodyChars
    );
  }
}
