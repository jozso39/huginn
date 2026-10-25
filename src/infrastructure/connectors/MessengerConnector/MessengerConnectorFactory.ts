import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import type { IConfig } from '@/lib/config';
import type { IMessengerClient } from '@/core/clients/MessengerClient/MessengerClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import type {
  IConnector,
  IConnectorFactory,
  IConnectorPairing,
  SecretField,
  SignInResult,
} from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type {
  ILoginWindow,
  LoginWindowRequest,
  SessionCookies,
} from '@/core/login/LoginWindow.types';
import { HelperMessengerClient } from '@/infrastructure/clients/MessengerClient/MessengerClient';
import { MESSENGER_DEFAULT_RULES } from '@/infrastructure/connectors/defaultRules';
import { MessengerConnector } from './MessengerConnector';

/**
 * Facebook's own login page. Signed in means the home page or the chats (the same test
 * mautrix-meta's login uses); the login, two-factor and checkpoint pages are on the way.
 */
const LOGIN_PAGE: Omit<LoginWindowRequest, 'userAgent'> = {
  title: 'Log in to Messenger',
  url: 'https://www.facebook.com/login/',
  hosts: ['facebook.com', 'messenger.com', 'fbcdn.net', 'facebook.net', 'fbsbx.com'],
  done: '^https://www\\.facebook\\.com/(?:messages/(?:e2ee/)?(?:t/[0-9]+/?)?)?(?:\\?.*)?$',
  cookieDomain: 'facebook.com',
  required: ['xs', 'c_user', 'datr'],
  optional: ['sb', 'fr'],
};

const storedCookies = z.record(z.string(), z.string());

const cookiesOf = (secrets: Secrets): SessionCookies => {
  try {
    return storedCookies.parse(JSON.parse(secrets.cookies ?? '{}'));
  } catch {
    return {};
  }
};

/**
 * Messenger, signed in on Facebook's own page in a window of the Mac app. The session's
 * cookies are the connection's secret, stored encrypted like any token; the device keys
 * for encrypted chats stay in the helper's folder next to the database.
 */
export class MessengerConnectorFactory implements IConnectorFactory {
  public readonly kind = ConnectorKind.Messenger;
  public readonly label = 'Messenger';
  public readonly defaultRules = MESSENGER_DEFAULT_RULES;
  public readonly capabilities = MessengerConnector.capabilities;
  public readonly configSchema = z.object({});
  public readonly secretFields: readonly SecretField[] = [];
  public readonly pairing: IConnectorPairing;
  private readonly client: IMessengerClient;
  // Sign-ins whose window is open, by the code the dashboard waits on.
  private readonly logins = new Map<string, Promise<SessionCookies | null>>();

  constructor(
    private readonly logger: Logger,
    private readonly config: IConfig,
    private readonly loginWindow: ILoginWindow | null,
    client?: IMessengerClient
  ) {
    const shared =
      client ??
      new HelperMessengerClient(logger, {
        ...config.messenger,
        restartBackoffMs: config.connectors.restartBackoffMs,
      });

    this.client = shared;
    this.pairing = {
      inWindow: true,
      isPaired: (secrets: Secrets) => Object.keys(cookiesOf(secrets)).length > 0,
      start: async () => {
        if (!this.loginWindow) {
          throw new HuginnError(ErrorCode.Unsupported, 'Messenger signs in only in the Mac app');
        }

        const code = crypto.randomUUID();
        const opened = this.loginWindow.open({
          ...LOGIN_PAGE,
          userAgent: await shared.userAgent(),
        });

        this.logins.set(code, opened);

        return { code };
      },
      finish: async (code: string): Promise<SignInResult> => {
        const cookies = await this.logins.get(code);

        this.logins.delete(code);

        if (!cookies) {
          throw new HuginnError(
            ErrorCode.Validation,
            'The login window was closed before you logged in'
          );
        }

        const account = await shared.login(cookies);

        return {
          secrets: { cookies: JSON.stringify(account.cookies) },
          account: account.userId,
          name: 'Messenger',
        };
      },
    };
  }

  public create(connection: Connection, secrets: Secrets): IConnector {
    return new MessengerConnector(
      this.logger,
      connection,
      this.client.session(cookiesOf(secrets)),
      secrets.account ?? '',
      this.config.maxBodyChars
    );
  }

  public unavailableReason(): string | null {
    if (!this.loginWindow) {
      return 'Needs the Huginn Mac app: you log in on Facebook’s own page in its window';
    }

    return this.client.isAvailable() ? null : 'The Messenger helper is missing from this build';
  }

  public close(): Promise<void> {
    return this.client.close();
  }
}
