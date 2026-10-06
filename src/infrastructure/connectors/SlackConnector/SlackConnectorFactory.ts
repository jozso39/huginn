import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { ISlackClient } from '@/core/clients/SlackClient/SlackClient.types';
import type {
  ISlackOAuthClient,
  SlackTokens,
} from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import type { OAuthAppCredentials } from '@/core/oauth/OAuthApp.types';
import { SlackClient } from '@/infrastructure/clients/SlackClient/SlackClient';
import { SLACK_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { pollIntervalField, pollMs } from '@/infrastructure/connectors/pollInterval';
import { SlackAuthorization } from './SlackAuthorization';
import { SlackConnector } from './SlackConnector';
import { SlackChannelScope, SlackReadMode } from './SlackConnector.types';
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
        'DMs, mentions and replies in your threads always come in. Besides them: only the channels you list, or every channel you are in.',
      optionLabels: {
        [SlackChannelScope.AddressedToMe]: 'Only what is addressed to me',
        [SlackChannelScope.AllMyChannels]: 'Everything in channels I am in',
      },
    }),
  // Each list only means something with one choice above, so the form shows just that one.
  watchChannels: z
    .string()
    .default('')
    .meta({
      title: 'Also watch',
      description: '#general, #releases — every message in these comes in too',
      shownWhen: { channelScope: SlackChannelScope.AddressedToMe },
    }),
  ignoreChannels: z
    .string()
    .default('')
    .meta({
      title: 'Ignore',
      description: '#random, #lunch — left out; mentions there still come through',
      shownWhen: { channelScope: SlackChannelScope.AllMyChannels },
    }),
  whenRead: z
    .enum(SlackReadMode)
    .default(SlackReadMode.Keep)
    .meta({
      title: 'Read in Slack',
      description:
        'Checked once a minute. Thread replies have their own read state Slack does not share, so they stay.',
      optionLabels: {
        [SlackReadMode.Keep]: 'Keep it in Huginn until I deal with it here',
        [SlackReadMode.Clear]: 'Clear it from Huginn',
      },
    }),
  checkEvery: pollIntervalField,
});

export type SlackClientFactory = (
  tokens: SlackTokens,
  refresh: ((refreshToken: string) => Promise<SlackTokens>) | null
) => ISlackClient;

/**
 * Created by signing in with Slack (the company's own app, set up once per Mac with its
 * client ID). Each person's Huginn checks Slack with that person's own token.
 */
export class SlackConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Slack;
  public readonly label = 'Slack';
  public readonly defaultRules = SLACK_DEFAULT_RULES;
  public readonly capabilities = SlackConnector.capabilities;
  public readonly configSchema = slackConfigSchema;
  public readonly secretFields: readonly SecretField[] = [];
  public readonly authorization: SlackAuthorization;

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    private readonly oauth: ISlackOAuthClient,
    private readonly createClient: SlackClientFactory = (tokens, refresh) =>
      new SlackClient(logger, { tokens, refresh })
  ) {
    this.authorization = new SlackAuthorization(oauth);
  }

  public create(
    connection: Connection,
    secrets: Secrets,
    app: OAuthAppCredentials | null
  ): IConnector {
    const parsed = slackConfigSchema.parse(connection.config);
    const tokens: SlackTokens = {
      accessToken: secrets.userToken ?? '',
      refreshToken: secrets.refreshToken ?? null,
      expiresAt: secrets.expiresAt ? Number(secrets.expiresAt) : null,
    };
    const refresh = app
      ? (refreshToken: string) => this.oauth.refresh({ clientId: app.clientId, refreshToken })
      : null;

    return new SlackConnector(
      this.logger,
      connection,
      this.createClient(tokens, refresh),
      {
        scope: parsed.channelScope,
        watch: parseChannelList(parsed.watchChannels),
        ignore: parseChannelList(parsed.ignoreChannels),
        whenRead: parsed.whenRead,
      },
      this.config.maxBodyChars,
      this.config.connectors.slackReadCheckMs,
      {
        intervalMs: pollMs(parsed.checkEvery, this.config.connectors.pollOverrideMs),
        lookbackMs: this.config.connectors.slackLookbackMs,
      }
    );
  }
}
