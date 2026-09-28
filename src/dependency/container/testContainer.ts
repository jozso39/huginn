import pino from 'pino';
import type { IConfig } from '@/lib/config';
import { createConfig } from '@/lib/config';
import type { Logger } from '@/lib/logger';
import type { ISlackClient } from '@/core/clients/SlackClient/SlackClient.types';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import { MockGitLabClient } from '@/infrastructure/clients/GitLabClient/GitLabClient.mock';
import { MockSlackClient } from '@/infrastructure/clients/SlackClient/SlackClient.mock';
import { GitLabConnectorFactory } from '@/infrastructure/connectors/GitLabConnector/GitLabConnectorFactory';
import { IngestConnectorFactory } from '@/infrastructure/connectors/IngestConnector/IngestConnectorFactory';
import { SlackConnectorFactory } from '@/infrastructure/connectors/SlackConnector/SlackConnectorFactory';
import { createContainer } from './container';
import type { Container } from './container.types';

export const createTestLogger = (): Logger => pino({ level: 'silent' });

export interface CreateTestContainerOptions {
  readonly connectorFactories?: readonly IConnectorFactory[];
  /** Hand in your own mock to drive Slack events from the test. */
  readonly slackClient?: ISlackClient;
}

const createTestConfig = (): IConfig => ({
  ...createConfig(),
  env: 'test',
  dbPath: ':memory:',
  logLevel: 'silent',
  connectors: {
    // Long enough that no interval fires during a test.
    gitlabPollMs: 60 * 60 * 1000,
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
      new IngestConnectorFactory(),
    ],
  });
};
