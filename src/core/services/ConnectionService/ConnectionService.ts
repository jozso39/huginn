import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { Connection, NewConnection, Secrets } from '@/core/connections/Connection.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type { IConnectorFactory } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IConnectorHost } from '@/core/services/ConnectorHost/ConnectorHost.types';
import type { ConnectorDescriptor, IConnectionService } from './ConnectionService.types';

export class ConnectionService implements IConnectionService {
  constructor(
    private readonly logger: Logger,
    private readonly factories: readonly IConnectorFactory[],
    private readonly connectionStore: IConnectionStore,
    private readonly secretBox: ISecretBox,
    private readonly connectorHost: IConnectorHost
  ) {}

  public describeConnectors(): readonly ConnectorDescriptor[] {
    return this.factories.map((factory) => ({
      kind: factory.kind,
      label: factory.label,
      configSchema: z.toJSONSchema(factory.configSchema),
      secretFields: factory.secretFields,
    }));
  }

  public list(): Promise<readonly Connection[]> {
    return this.connectionStore.list();
  }

  public get(id: string): Promise<Connection | null> {
    return this.connectionStore.get(id);
  }

  public async create(input: NewConnection): Promise<Connection> {
    const factory = this.factory(input.kind);
    const config = this.parseConfig(factory, input.config);

    this.assertSecretsComplete(factory, input.secrets);

    const connection = await this.connectionStore.create({
      kind: input.kind,
      name: input.name,
      config,
      secretsCiphertext: await this.secretBox.seal(JSON.stringify(input.secrets)),
    });

    this.logger.info({ connectionId: connection.id, kind: connection.kind }, 'connection created');

    return this.restartAndReload(connection.id);
  }

  public async updateConfig(
    id: string,
    name: string,
    config: Connection['config']
  ): Promise<Connection> {
    const existing = await this.require(id);
    const parsed = this.parseConfig(this.factory(existing.kind), config);

    await this.connectionStore.update(id, { name, config: parsed });

    return this.restartAndReload(id);
  }

  public async updateSecrets(id: string, secrets: Secrets): Promise<void> {
    const existing = await this.require(id);
    const ciphertext = await this.connectionStore.getSecretsCiphertext(id);
    const current = ciphertext
      ? (JSON.parse(await this.secretBox.open(ciphertext)) as Secrets)
      : {};
    // Empty strings mean "leave this one alone" so the form can show blanks.
    const provided = Object.fromEntries(
      Object.entries(secrets).filter(([, value]) => value.length > 0)
    );
    const merged = { ...current, ...provided };

    this.assertSecretsComplete(this.factory(existing.kind), merged);
    await this.connectionStore.updateSecrets(id, await this.secretBox.seal(JSON.stringify(merged)));
    await this.connectorHost.restart(id);
  }

  public async setEnabled(id: string, enabled: boolean): Promise<Connection> {
    await this.require(id);
    await this.connectionStore.update(id, { enabled });

    return this.restartAndReload(id);
  }

  public async remove(id: string): Promise<void> {
    await this.require(id);
    await this.connectorHost.stop(id);
    await this.connectionStore.remove(id);
  }

  private factory(kind: Connection['kind']): IConnectorFactory {
    const factory = this.factories.find((candidate) => candidate.kind === kind);

    if (!factory) {
      throw new HuginnError(ErrorCode.Validation, `unknown connector kind ${kind}`);
    }

    return factory;
  }

  private parseConfig(factory: IConnectorFactory, config: unknown): Connection['config'] {
    const result = factory.configSchema.safeParse(config);

    if (!result.success) {
      throw new HuginnError(ErrorCode.Validation, 'invalid connection config', result.error.issues);
    }

    return result.data as Connection['config'];
  }

  private assertSecretsComplete(factory: IConnectorFactory, secrets: Secrets): void {
    const missing = factory.secretFields
      .filter((field) => !secrets[field.key])
      .map((field) => field.key);

    if (missing.length > 0) {
      throw new HuginnError(ErrorCode.Validation, `missing secrets: ${missing.join(', ')}`);
    }
  }

  /** The host writes status while starting, so the caller wants the row after that. */
  private async restartAndReload(id: string): Promise<Connection> {
    await this.connectorHost.restart(id);

    return this.require(id);
  }

  private async require(id: string): Promise<Connection> {
    const connection = await this.connectionStore.get(id);

    if (!connection) {
      throw new HuginnError(ErrorCode.NotFound, `connection ${id} not found`);
    }

    return connection;
  }
}
