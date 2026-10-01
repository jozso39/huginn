import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IClickUpClient } from '@/core/clients/ClickUpClient/ClickUpClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type { IConnector, IConnectorFactory, SecretField } from '@/core/connectors/Connector.types';
import { ClickUpClient } from '@/infrastructure/clients/ClickUpClient/ClickUpClient';
import { CLICKUP_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { pollIntervalField, pollMs } from '@/infrastructure/connectors/pollInterval';
import { ClickUpConnector } from './ClickUpConnector';

export const clickUpConfigSchema = z.object({
  workspaceId: z.string().trim().default('').meta({
    title: 'Workspace ID',
    description: 'Only if your token sees several workspaces; Huginn tells you which.',
  }),
  checkEvery: pollIntervalField,
});

export type ClickUpClientFactory = (token: string) => IClickUpClient;

export class ClickUpConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.ClickUp;
  public readonly label = 'ClickUp';
  public readonly defaultRules = CLICKUP_DEFAULT_RULES;
  public readonly capabilities = ClickUpConnector.capabilities;
  public readonly configSchema = clickUpConfigSchema;
  public readonly secretFields: readonly SecretField[] = [
    {
      key: 'token',
      label: 'Personal API token (pk_…)',
      hint: 'ClickUp → avatar → Settings → Apps → API Token.',
    },
  ];

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    private readonly createClient: ClickUpClientFactory = (token) =>
      new ClickUpClient(logger, { token, timeoutMs: 15_000 })
  ) {}

  public create(connection: Connection, secrets: Secrets): IConnector {
    const { workspaceId, checkEvery } = clickUpConfigSchema.parse(connection.config);

    return new ClickUpConnector(
      this.logger,
      connection,
      this.createClient(secrets.token ?? ''),
      workspaceId === '' ? null : workspaceId,
      pollMs(checkEvery, this.config.connectors.pollOverrideMs),
      this.config.maxBodyChars
    );
  }
}
