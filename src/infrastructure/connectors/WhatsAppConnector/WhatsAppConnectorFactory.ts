import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IWhatsAppClient } from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type {
  IConnector,
  IConnectorFactory,
  IConnectorPairing,
  SecretField,
  SignInResult,
} from '@/core/connectors/Connector.types';
import { BaileysWhatsAppClient } from '@/infrastructure/clients/WhatsAppClient/WhatsAppClient';
import { WHATSAPP_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { WhatsAppConnector } from './WhatsAppConnector';

/**
 * WhatsApp, linked as a device of the user's phone (Settings → Linked devices → Link a
 * device). The device's keys are the connection's secret, so they are stored encrypted
 * like any token and go when the connection is deleted.
 */
export class WhatsAppConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.WhatsApp;
  public readonly label = 'WhatsApp';
  public readonly defaultRules = WHATSAPP_DEFAULT_RULES;
  public readonly capabilities = WhatsAppConnector.capabilities;
  public readonly configSchema = z.object({});
  public readonly secretFields: readonly SecretField[] = [];
  public readonly pairing: IConnectorPairing;
  private readonly client: IWhatsAppClient;

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    client?: IWhatsAppClient
  ) {
    const shared = client ?? new BaileysWhatsAppClient(logger);

    this.client = shared;
    this.pairing = {
      isPaired: (secrets: Secrets) => Boolean(secrets.auth),
      start: async () => ({ code: await shared.startLink() }),
      currentCode: (code: string) => shared.currentLinkCode(code),
      linkWithPhone: (code: string, phoneNumber: string) => shared.linkWithPhone(code, phoneNumber),
      finish: async (code: string): Promise<SignInResult> => {
        const link = await shared.finishLink(code);

        return { secrets: { auth: link.auth }, account: link.account, name: 'WhatsApp' };
      },
    };
  }

  public create(connection: Connection, secrets: Secrets): IConnector {
    return new WhatsAppConnector(
      this.logger,
      connection,
      this.client.session(secrets.auth ?? ''),
      secrets.account ?? '',
      this.config.maxBodyChars
    );
  }

  public close(): Promise<void> {
    return this.client.close();
  }
}
