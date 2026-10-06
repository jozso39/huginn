import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { ISignalClient } from '@/core/clients/SignalClient/SignalClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type {
  IConnector,
  IConnectorFactory,
  IConnectorPairing,
  SecretField,
  SignInResult,
} from '@/core/connectors/Connector.types';
import { SignalRpcClient } from '@/infrastructure/clients/SignalClient/SignalClient';
import { SIGNAL_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { SignalConnector } from './SignalConnector';

/** What the phone lists under Linked devices. */
const DEVICE_NAME = 'Huginn';

/**
 * Signal, linked as a device of the user's phone (Settings → Linked devices → scan).
 * One signal-cli serves every Signal connection, so the client is shared. Offered only
 * where signal-cli is installed: Huginn does not ship it.
 */
export class SignalConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Signal;
  public readonly label = 'Signal';
  public readonly defaultRules = SIGNAL_DEFAULT_RULES;
  public readonly capabilities = SignalConnector.capabilities;
  public readonly configSchema = z.object({});
  public readonly secretFields: readonly SecretField[] = [];
  public readonly pairing: IConnectorPairing;
  private readonly client: ISignalClient;

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    client?: ISignalClient
  ) {
    const shared =
      client ??
      new SignalRpcClient(logger, {
        ...config.signal,
        restartBackoffMs: config.connectors.restartBackoffMs,
      });

    this.client = shared;
    this.pairing = {
      isPaired: (secrets: Secrets) => Boolean(secrets.account),
      start: async () => ({ code: await shared.startLink() }),
      finish: async (code: string): Promise<SignInResult> => {
        const account = await shared.finishLink(code, DEVICE_NAME);

        return { secrets: {}, account };
      },
    };
  }

  public create(connection: Connection, secrets: Secrets): IConnector {
    return new SignalConnector(
      this.logger,
      connection,
      this.client,
      secrets.account ?? '',
      this.config.maxBodyChars
    );
  }

  public unavailableReason(): string | null {
    return this.client.isAvailable()
      ? null
      : 'Needs signal-cli on this Mac: brew install signal-cli';
  }

  public close(): Promise<void> {
    return this.client.close();
  }
}
