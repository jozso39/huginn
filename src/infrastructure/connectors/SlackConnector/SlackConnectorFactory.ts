import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { ISlackClient } from '@/core/clients/SlackClient/SlackClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import { SlackClient } from '@/infrastructure/clients/SlackClient/SlackClient';
import { SLACK_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { SlackConnector } from './SlackConnector';
import { SlackChannelScope } from './SlackConnector.types';
import { parseChannelList } from './SlackConnector.utils';

// DMs, mentions and replies in your threads always come in; these settings decide
// which *other* channel messages do.
export const slackConfigSchema = z.object({
  channelScope: z
    .enum(SlackChannelScope)
    .default(SlackChannelScope.AddressedToMe)
    .meta({
      title: 'Channel messages',
      description:
        'Besides DMs, mentions and your threads: nothing else, or every channel you are in.',
      optionLabels: {
        [SlackChannelScope.AddressedToMe]: 'Only what is addressed to me',
        [SlackChannelScope.AllMyChannels]: 'Everything in channels I am in',
      },
    }),
  watchChannels: z.string().default('').meta({
    title: 'Also watch',
    description: '#general, #releases — used with "Only what is addressed to me"',
  }),
  ignoreChannels: z.string().default('').meta({
    title: 'Ignore',
    description: '#random, #lunch — used with "Everything"; mentions still come through',
  }),
});

export type SlackClientFactory = (userToken: string, appToken: string) => ISlackClient;

export class SlackConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Slack;
  public readonly label = 'Slack';
  public readonly defaultRules = SLACK_DEFAULT_RULES;
  public readonly capabilities = SlackConnector.capabilities;
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
    const parsed = slackConfigSchema.parse(connection.config);

    return new SlackConnector(
      this.logger,
      connection,
      this.createClient(secrets.userToken ?? '', secrets.appToken ?? ''),
      {
        scope: parsed.channelScope,
        watch: parseChannelList(parsed.watchChannels),
        ignore: parseChannelList(parsed.ignoreChannels),
      },
      this.config.maxBodyChars
    );
  }
}
