import pino from 'pino';
import type { IConfig } from '@/lib/config';
import { createConfig } from '@/lib/config';
import type { Logger } from '@/lib/logger';
import type { IClickUpClient } from '@/core/clients/ClickUpClient/ClickUpClient.types';
import type { IGmailClient } from '@/core/clients/GmailClient/GmailClient.types';
import type { ISlackClient } from '@/core/clients/SlackClient/SlackClient.types';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import { MockClickUpClient } from '@/infrastructure/clients/ClickUpClient/ClickUpClient.mock';
import { MockGitLabClient } from '@/infrastructure/clients/GitLabClient/GitLabClient.mock';
import { MockGmailClient } from '@/infrastructure/clients/GmailClient/GmailClient.mock';
import { MockGoogleOAuthClient } from '@/infrastructure/clients/GoogleOAuthClient/GoogleOAuthClient.mock';
import { MockSlackClient } from '@/infrastructure/clients/SlackClient/SlackClient.mock';
import { ClickUpConnectorFactory } from '@/infrastructure/connectors/ClickUpConnector/ClickUpConnectorFactory';
import { GitLabConnectorFactory } from '@/infrastructure/connectors/GitLabConnector/GitLabConnectorFactory';
import { GmailConnectorFactory } from '@/infrastructure/connectors/GmailConnector/GmailConnectorFactory';
import { IngestConnectorFactory } from '@/infrastructure/connectors/IngestConnector/IngestConnectorFactory';
import { SlackConnectorFactory } from '@/infrastructure/connectors/SlackConnector/SlackConnectorFactory';
import { createContainer } from './container';
import type { Container } from './container.types';

export const createTestLogger = (): Logger => pino({ level: 'silent' });

export interface CreateTestContainerOptions {
  readonly connectorFactories?: readonly IConnectorFactory[];
  /** Hand in your own mock to drive Slack events from the test. */
  readonly slackClient?: ISlackClient;
  /** Same for Gmail. */
  readonly gmailClient?: IGmailClient;
  /** Same for ClickUp. */
  readonly clickUpClient?: IClickUpClient;
}

const createTestConfig = (): IConfig => ({
  ...createConfig(),
  env: 'test',
  dbPath: ':memory:',
  publicUrl: 'https://huginn.test.ts.net',
  oauthRelayUrl: 'https://relay.example.com/oauth/huginn/',
  logLevel: 'silent',
  connectors: {
    // Long enough that no interval fires during a test.
    gitlabPollMs: 60 * 60 * 1000,
    gmailPollMs: 60 * 60 * 1000,
    clickUpPollMs: 60 * 60 * 1000,
    restartBackoffMs: [60 * 60 * 1000],
  },
});

/**
 * A real container on an in-memory SQLite with every external client mocked.
 * Stores, services and the host are the real ones: that is what the tests are for.
 */
export const createTestContainer = (options: CreateTestContainerOptions = {}): Container => {
  const config = createTestConfig();
  const logger = createTestLogger();

  return createContainer({
    config,
    logger,
    connectorFactories: options.connectorFactories ?? [
      new GitLabConnectorFactory(logger, config, () => new MockGitLabClient()),
      new SlackConnectorFactory(logger, config, () => options.slackClient ?? new MockSlackClient()),
      new GmailConnectorFactory(
        logger,
        config,
        new MockGoogleOAuthClient(),
        () => options.gmailClient ?? new MockGmailClient()
      ),
      new ClickUpConnectorFactory(
        logger,
        config,
        () => options.clickUpClient ?? new MockClickUpClient()
      ),
      new IngestConnectorFactory(),
    ],
  });
};
