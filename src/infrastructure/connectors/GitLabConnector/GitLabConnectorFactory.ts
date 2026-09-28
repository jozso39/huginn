import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IGitLabClient } from '@/core/clients/GitLabClient/GitLabClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import { GitLabClient } from '@/infrastructure/clients/GitLabClient/GitLabClient';
import { GITLAB_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { GitLabConnector } from './GitLabConnector';

export const gitLabConfigSchema = z.object({
  baseUrl: z.url().meta({ title: 'GitLab URL', description: 'https://gitlab.example.com' }),
});

export type GitLabConfig = z.infer<typeof gitLabConfigSchema>;

export type GitLabClientFactory = (baseUrl: string, token: string) => IGitLabClient;

export class GitLabConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.GitLab;
  public readonly label = 'GitLab';
  public readonly defaultRules = GITLAB_DEFAULT_RULES;
  public readonly capabilities = GitLabConnector.capabilities;
  public readonly configSchema = gitLabConfigSchema;
  public readonly secretFields: readonly SecretField[] = [
    {
      key: 'token',
      label: 'Personal access token',
      hint: 'Scope "api" — needed to mark todos done and to comment.',
    },
  ];

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    // Injected so tests can hand in the mock client without touching the network.
    private readonly createClient: GitLabClientFactory = (baseUrl, token) =>
      new GitLabClient(logger, { baseUrl, token, timeoutMs: 15_000 })
  ) {}

  public create(connection: Connection, secrets: Secrets): IConnector {
    const { baseUrl } = gitLabConfigSchema.parse(connection.config);

    return new GitLabConnector(
      this.logger,
      connection,
      this.createClient(baseUrl, secrets.token ?? ''),
      this.config.connectors.gitlabPollMs,
      this.config.maxBodyChars
    );
  }
}
