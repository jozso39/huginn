import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { Connection, NewConnection, Secrets } from '@/core/connections/Connection.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type { IConnectorAuthorization, IConnectorFactory } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IConnectorHost } from '@/core/services/ConnectorHost/ConnectorHost.types';
import type {
  ConnectorDescriptor,
  IConnectionService,
  SignInStart,
} from './ConnectionService.types';

/** Long enough to find the password manager; short enough that a stray link dies. */
const SIGN_IN_TTL_MS = 15 * 60 * 1000;

interface PendingSignIn {
  readonly connectionId: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

export class ConnectionService implements IConnectionService {
  // The OAuth `state` is the only thing tying a redirect back to a connection, and
  // it is single-use; losing these on restart just means clicking Sign in again.
  private readonly pendingSignIns = new Map<string, PendingSignIn>();

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
      // Input side: a field with a default is optional to fill in, not required.
      configSchema: z.toJSONSchema(factory.configSchema, { io: 'input' }),
      secretFields: factory.secretFields,
      capabilities: factory.capabilities,
      signIn: factory.authorization !== undefined,
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
    const current = await this.openSecrets(id);
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

  public async beginSignIn(id: string): Promise<SignInStart> {
    const connection = await this.require(id);
    const authorization = this.authorizationOf(connection);
    const state = crypto.randomUUID();
    const start = authorization.start(connection, await this.openSecrets(id), state);
    const now = Date.now();

    // Drop expired attempts so the map cannot grow without bound.
    [...this.pendingSignIns.entries()]
      .filter(([, pending]) => pending.expiresAt < now)
      .forEach(([key]) => this.pendingSignIns.delete(key));
    this.pendingSignIns.set(state, {
      connectionId: id,
      redirectUri: start.redirectUri,
      expiresAt: now + SIGN_IN_TTL_MS,
    });

    return { url: start.url, mode: start.mode };
  }

  public async completeSignIn(redirectedTo: string): Promise<Connection> {
    const params = ConnectionService.redirectParams(redirectedTo);
    const state = params.get('state') ?? '';
    const pending = this.pendingSignIns.get(state);

    if (!pending || pending.expiresAt < Date.now()) {
      throw new HuginnError(
        ErrorCode.Validation,
        'This sign-in expired or was already used — click Sign in again'
      );
    }

    this.pendingSignIns.delete(state);

    const providerError = params.get('error');

    if (providerError) {
      throw new HuginnError(ErrorCode.Unauthorized, `Sign-in was refused: ${providerError}`);
    }

    const code = params.get('code');

    if (!code) {
      throw new HuginnError(ErrorCode.Validation, 'That address has no sign-in code in it');
    }

    const connection = await this.require(pending.connectionId);
    const current = await this.openSecrets(connection.id);
    const added = await this.authorizationOf(connection).complete(
      connection,
      current,
      code,
      pending.redirectUri
    );

    await this.connectionStore.updateSecrets(
      connection.id,
      await this.secretBox.seal(JSON.stringify({ ...current, ...added }))
    );
    this.logger.info({ connectionId: connection.id }, 'connection signed in');

    return this.restartAndReload(connection.id);
  }

  /** Accepts a full URL, a bare query string, or a fragment with the parameters. */
  private static redirectParams(redirectedTo: string): URLSearchParams {
    const trimmed = redirectedTo.trim();
    const query = trimmed.includes('?') ? trimmed.slice(trimmed.indexOf('?') + 1) : trimmed;

    return new URLSearchParams(query.split('#')[0]);
  }

  private authorizationOf(connection: Connection): IConnectorAuthorization {
    const authorization = this.factory(connection.kind).authorization;

    if (!authorization) {
      throw new HuginnError(ErrorCode.Unsupported, `${connection.kind} needs no sign-in`);
    }

    return authorization;
  }

  private async openSecrets(id: string): Promise<Secrets> {
    const ciphertext = await this.connectionStore.getSecretsCiphertext(id);

    return ciphertext ? (JSON.parse(await this.secretBox.open(ciphertext)) as Secrets) : {};
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
