import pino from 'pino';
import type { IConfig } from '@/lib/config';
import { createConfig } from '@/lib/config';
import type { Logger } from '@/lib/logger';
import type { IClickUpClient } from '@/core/clients/ClickUpClient/ClickUpClient.types';
import type { IGmailClient } from '@/core/clients/GmailClient/GmailClient.types';
import type { IJevClient } from '@/core/clients/JevClient/JevClient.types';
import type { ILlmClient } from '@/core/clients/LlmClient/LlmClient.types';
import type { IAttentionSink } from '@/core/attention/Attention.types';
import type { ISignalClient } from '@/core/clients/SignalClient/SignalClient.types';
import type { IAiKeyChecker } from '@/core/settings/AiKey.types';
import type { ISlackOAuthClient } from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';
import type { ISlackClient } from '@/core/clients/SlackClient/SlackClient.types';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import { MockClickUpClient } from '@/infrastructure/clients/ClickUpClient/ClickUpClient.mock';
import { MockGitLabClient } from '@/infrastructure/clients/GitLabClient/GitLabClient.mock';
import { MockGmailClient } from '@/infrastructure/clients/GmailClient/GmailClient.mock';
import { MockGoogleOAuthClient } from '@/infrastructure/clients/GoogleOAuthClient/GoogleOAuthClient.mock';
import { MockJevClient } from '@/core/clients/JevClient/JevClient.mock';
import { MockLlmClient } from '@/core/clients/LlmClient/LlmClient.mock';
import { MockSignalClient } from '@/infrastructure/clients/SignalClient/SignalClient.mock';
import { MockAiKeyChecker } from '@/infrastructure/clients/AiKeyChecker/AiKeyChecker.mock';
import { MockSlackOAuthClient } from '@/infrastructure/clients/SlackOAuthClient/SlackOAuthClient.mock';
import { MockSlackClient } from '@/infrastructure/clients/SlackClient/SlackClient.mock';
import { ClickUpConnectorFactory } from '@/infrastructure/connectors/ClickUpConnector/ClickUpConnectorFactory';
import { GitLabConnectorFactory } from '@/infrastructure/connectors/GitLabConnector/GitLabConnectorFactory';
import { GmailConnectorFactory } from '@/infrastructure/connectors/GmailConnector/GmailConnectorFactory';
import { LinkedInConnectorFactory } from '@/infrastructure/connectors/LinkedInConnector/LinkedInConnectorFactory';
import { SignalConnectorFactory } from '@/infrastructure/connectors/SignalConnector/SignalConnectorFactory';
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
  /** Same for Signal. */
  readonly signalClient?: ISignalClient;
  /** Hand in your own MockSlackOAuthClient to see sign-ins and token refreshes. */
  readonly slackOAuthClient?: ISlackOAuthClient;
  /** Where the browser reaches Huginn; the Mac app's own address for Slack sign-ins. */
  readonly publicUrl?: string;
  /** Hand in a MockJevClient to decide what soft rules and guardrails answer. */
  readonly jev?: IJevClient;
  readonly llm?: ILlmClient;
  /** Hand in a MockAttentionSink to see what the Mac app would show. */
  readonly attentionSink?: IAttentionSink;
  /** Hand in a MockAiKeyChecker to see which keys were checked. */
  readonly aiKeyChecker?: IAiKeyChecker;
}

const createTestConfig = (publicUrl = 'https://huginn.test.ts.net'): IConfig => ({
  ...createConfig(),
  env: 'test',
  dbPath: ':memory:',
  publicUrl,
  oauthRelayUrl: 'https://relay.example.com/oauth/huginn/',
  logLevel: 'silent',
  connectors: {
    // Long enough that no interval fires during a test.
    pollOverrideMs: 60 * 60 * 1000,
    slackReadCheckMs: 60 * 60 * 1000,
    // Far enough back for the fixtures' fixed timestamps.
    slackLookbackMs: 20 * 365 * 24 * 60 * 60 * 1000,
    restartBackoffMs: [60 * 60 * 1000],
  },
});

/**
 * A real container on an in-memory SQLite with every external client mocked.
 * Stores, services and the host are the real ones: that is what the tests are for.
 */
export const createTestContainer = (options: CreateTestContainerOptions = {}): Container => {
  const config = createTestConfig(options.publicUrl);
  const logger = createTestLogger();

  return createContainer({
    config,
    logger,
    jev: options.jev ?? new MockJevClient(),
    llm: options.llm ?? new MockLlmClient(),
    aiKeyChecker: options.aiKeyChecker ?? new MockAiKeyChecker(),
    ...(options.attentionSink ? { attentionSink: options.attentionSink } : {}),
    connectorFactories: options.connectorFactories ?? [
      new GitLabConnectorFactory(logger, config, () => new MockGitLabClient()),
      new SlackConnectorFactory(
        logger,
        config,
        options.slackOAuthClient ?? new MockSlackOAuthClient(),
        () => options.slackClient ?? new MockSlackClient()
      ),
      new GmailConnectorFactory(
        logger,
        config,
        new MockGoogleOAuthClient(),
        () => options.gmailClient ?? new MockGmailClient()
      ),
      new LinkedInConnectorFactory(
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
      new SignalConnectorFactory(logger, config, options.signalClient ?? new MockSignalClient()),
    ],
  });
};
