import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { Connection, NewConnection, Secrets } from '@/core/connections/Connection.types';
import type { IConnectionStore } from '@/core/connections/ConnectionStore.types';
import type {
  IConnectorAuthorization,
  IConnectorFactory,
  IConnectorPairing,
  SignInResult,
} from '@/core/connectors/Connector.types';
import type { SignInApp } from '@/core/oauth/OAuthApp.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IConnectorHost } from '@/core/services/ConnectorHost/ConnectorHost.types';
import type { IOAuthAppService } from '@/core/services/OAuthAppService/OAuthAppService.types';
import type { IRuleService } from '@/core/services/RuleService/RuleService.types';
import type {
  ConnectorDescriptor,
  IConnectionService,
  PairingStart,
  PairingStatus,
  SignInStart,
  SignInTarget,
} from './ConnectionService.types';
import { PairingState } from './ConnectionService.types';

/** Long enough to find the password manager; short enough that a stray link dies. */
const SIGN_IN_TTL_MS = 15 * 60 * 1000;

interface PendingSignIn {
  readonly kind: Connection['kind'];
  /** Null: create a connection for whoever signs in (or reuse theirs). */
  readonly connectionId: string | null;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

/** A QR code the phone has not scanned by then is dead anyway. */
const PAIRING_TTL_MS = 10 * 60 * 1000;

interface Pairing extends PairingStatus {
  readonly expiresAt: number;
}

export class ConnectionService implements IConnectionService {
  // The OAuth `state` is the only thing tying a redirect back to a connection, and
  // it is single-use; losing these on restart just means clicking Sign in again.
  private readonly pendingSignIns = new Map<string, PendingSignIn>();
  private readonly pairings = new Map<string, Pairing>();

  constructor(
    private readonly logger: Logger,
    private readonly factories: readonly IConnectorFactory[],
    private readonly connectionStore: IConnectionStore,
    private readonly secretBox: ISecretBox,
    private readonly connectorHost: IConnectorHost,
    private readonly oauthApps: IOAuthAppService,
    private readonly rules: IRuleService,
    private readonly publicUrl: string | null
  ) {}

  public describeConnectors(): readonly ConnectorDescriptor[] {
    return this.factories.map((factory) => ({
      kind: factory.kind,
      label: factory.label,
      // Input side: a field with a default is optional to fill in, not required.
      configSchema: z.toJSONSchema(factory.configSchema, { io: 'input' }),
      secretFields: factory.secretFields,
      capabilities: factory.capabilities,
      signInProvider: factory.authorization?.provider ?? null,
      pairing: Boolean(factory.pairing),
      unavailable: factory.unavailableReason?.() ?? null,
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
      groupName: ConnectionService.groupOf(input.groupName),
    });

    this.logger.info({ connectionId: connection.id, kind: connection.kind }, 'connection created');
    // Rules first, so the first sync is already sorted.
    await this.rules.installDefaults(connection.id);

    return this.restartAndReload(connection.id);
  }

  public async updateConfig(
    id: string,
    name: string,
    config: Connection['config'],
    groupName?: string | null
  ): Promise<Connection> {
    const existing = await this.require(id);
    const parsed = this.parseConfig(this.factory(existing.kind), config);

    await this.connectionStore.update(id, {
      name,
      config: parsed,
      ...(groupName !== undefined ? { groupName: ConnectionService.groupOf(groupName) } : {}),
    });

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

  public async beginSignIn(target: SignInTarget): Promise<SignInStart> {
    const connection = 'connectionId' in target ? await this.require(target.connectionId) : null;
    const kind = connection?.kind ?? ('kind' in target ? target.kind : null);

    if (!kind) {
      throw new HuginnError(ErrorCode.Validation, 'say which connection or kind to sign in');
    }

    const authorization = this.authorizationOf(kind);
    const app = await this.appFor(authorization);
    const state = this.newState();
    const now = Date.now();

    // Drop expired attempts so the map cannot grow without bound.
    [...this.pendingSignIns.entries()]
      .filter(([, pending]) => pending.expiresAt < now)
      .forEach(([key]) => this.pendingSignIns.delete(key));
    this.pendingSignIns.set(state, {
      kind,
      connectionId: connection?.id ?? null,
      redirectUri: app.redirectUri,
      expiresAt: now + SIGN_IN_TTL_MS,
    });

    return { url: authorization.authorizationUrl(app, state) };
  }

  public async completeSignIn(callbackUrl: string): Promise<Connection> {
    const params = new URL(callbackUrl, 'http://callback.invalid').searchParams;
    const state = params.get('state') ?? '';
    const pending = this.pendingSignIns.get(state);

    if (!pending || pending.expiresAt < Date.now()) {
      throw new HuginnError(
        ErrorCode.Validation,
        'This sign-in expired or was already used — start it again'
      );
    }

    this.pendingSignIns.delete(state);

    const providerError = params.get('error');

    if (providerError) {
      throw new HuginnError(ErrorCode.Unauthorized, `Sign-in was refused: ${providerError}`);
    }

    const code = params.get('code');

    if (!code) {
      throw new HuginnError(ErrorCode.Validation, 'The provider sent no sign-in code');
    }

    const authorization = this.authorizationOf(pending.kind);
    const app = await this.appFor(authorization);
    // The code is bound to the redirect it was issued for, even if the setting changed since.
    const result = await authorization.complete({ ...app, redirectUri: pending.redirectUri }, code);

    return this.applySignIn(pending.kind, pending.connectionId, result);
  }

  public async beginPairing(target: SignInTarget): Promise<PairingStart> {
    const connection = 'connectionId' in target ? await this.require(target.connectionId) : null;
    const kind = connection?.kind ?? ('kind' in target ? target.kind : null);

    if (!kind) {
      throw new HuginnError(ErrorCode.Validation, 'say which connection or kind to link');
    }

    const pairing = this.pairingOf(kind);
    const { code } = await pairing.start();
    const pairingId = crypto.randomUUID();
    const now = Date.now();

    [...this.pairings.entries()]
      .filter(([, entry]) => entry.expiresAt < now)
      .forEach(([key]) => this.pairings.delete(key));
    this.pairings.set(pairingId, {
      state: PairingState.Waiting,
      connection: null,
      error: null,
      expiresAt: now + PAIRING_TTL_MS,
    });

    // The phone may take minutes; the dashboard polls pairingStatus meanwhile.
    void pairing
      .finish(code)
      .then((result) => this.applySignIn(kind, connection?.id ?? null, result))
      .then((linked) => this.settlePairing(pairingId, { connection: linked }))
      .catch((error: unknown) => {
        this.logger.warn({ kind, err: toError(error) }, 'pairing failed');
        this.settlePairing(pairingId, { error: toError(error).message });
      });

    return { pairingId, code };
  }

  public pairingStatus(pairingId: string): PairingStatus {
    const entry = this.pairings.get(pairingId);

    if (!entry) {
      throw new HuginnError(ErrorCode.NotFound, 'This link attempt expired — start it again');
    }

    return { state: entry.state, connection: entry.connection, error: entry.error };
  }

  private settlePairing(
    pairingId: string,
    outcome: { connection: Connection } | { error: string }
  ): void {
    const entry = this.pairings.get(pairingId);

    if (!entry) {
      return;
    }

    this.pairings.set(
      pairingId,
      'connection' in outcome
        ? { ...entry, state: PairingState.Linked, connection: outcome.connection }
        : { ...entry, state: PairingState.Failed, error: outcome.error }
    );
  }

  /** Creates the connection for that account, or refreshes the one it already has. */
  private async applySignIn(
    kind: Connection['kind'],
    connectionId: string | null,
    result: SignInResult
  ): Promise<Connection> {
    const existing = connectionId ?? (await this.findByAccount(kind, result.account));
    const secrets = { ...result.secrets, account: result.account };

    if (!existing) {
      this.logger.info({ kind }, 'signed in, creating connection');

      return this.create({ kind, name: result.account, config: {}, secrets });
    }

    const current = await this.openSecrets(existing);

    await this.connectionStore.updateSecrets(
      existing,
      await this.secretBox.seal(JSON.stringify({ ...current, ...secrets }))
    );
    this.logger.info({ connectionId: existing }, 'connection signed in again');

    return this.restartAndReload(existing);
  }

  private pairingOf(kind: Connection['kind']): IConnectorPairing {
    const pairing = this.factory(kind).pairing;

    if (!pairing) {
      throw new HuginnError(ErrorCode.Unsupported, `${kind} is not linked by scanning a code`);
    }

    return pairing;
  }

  /**
   * A random nonce plus where this Huginn lives, base64url-encoded. The relay page
   * reads the second half to know where to forward; the nonce is what we check.
   */
  private newState(): string {
    const home = Buffer.from(this.publicUrl ?? '', 'utf8').toString('base64url');

    return `${crypto.randomUUID()}.${home}`;
  }

  private async appFor(authorization: IConnectorAuthorization): Promise<SignInApp> {
    const app = await this.oauthApps.credentials(authorization.provider);

    if (!app) {
      throw new HuginnError(
        ErrorCode.Validation,
        `Set up ${authorization.provider} sign-in first (Connections → sign-in settings)`
      );
    }

    const { redirectUri } = app;

    if (!redirectUri) {
      throw new HuginnError(
        ErrorCode.Validation,
        `${authorization.provider} sign-in has nowhere to return to: choose "Direct" in its sign-in settings`
      );
    }

    return { ...app, redirectUri };
  }

  /** Signing in again with the same account refreshes its connection instead of duplicating it. */
  private async findByAccount(kind: Connection['kind'], account: string): Promise<string | null> {
    const sameKind = (await this.connectionStore.list()).filter((c) => c.kind === kind);
    const accounts = await Promise.all(
      sameKind.map(async (c) => ({ id: c.id, account: (await this.openSecrets(c.id)).account }))
    );

    return accounts.find((entry) => entry.account === account)?.id ?? null;
  }

  /** Blank means "its own group". */
  private static groupOf(groupName: string | null | undefined): string | null {
    const trimmed = groupName?.trim() ?? '';

    return trimmed === '' ? null : trimmed;
  }

  private authorizationOf(kind: Connection['kind']): IConnectorAuthorization {
    const authorization = this.factory(kind).authorization;

    if (!authorization) {
      throw new HuginnError(ErrorCode.Unsupported, `${kind} needs no sign-in`);
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
