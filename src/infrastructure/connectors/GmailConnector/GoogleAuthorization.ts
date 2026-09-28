import type { IGoogleOAuthClient } from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';
import type { Connection, Secrets } from '@/core/connections/Connection.types';
import type {
  AuthorizationStart,
  IConnectorAuthorization,
} from '@/core/connectors/Connector.types';
import { AuthorizationMode } from '@/core/connectors/Connector.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { GoogleClientType } from './GmailConnector.types';

/**
 * Read, send, drafts and marking read — one scope covers them all. It cannot
 * permanently delete mail (that would be the full https://mail.google.com/ scope).
 */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify'] as const;

/** Where a "Desktop app" OAuth client may send the user back. */
const DESKTOP_REDIRECT = 'http://localhost';

export const OAUTH_CALLBACK_PATH = '/api/oauth/callback';

export class GoogleAuthorization implements IConnectorAuthorization {
  constructor(
    private readonly oauth: IGoogleOAuthClient,
    private readonly publicUrl: string | null
  ) {}

  public isAuthorized(secrets: Secrets): boolean {
    return Boolean(secrets.refreshToken);
  }

  public start(connection: Connection, secrets: Secrets, state: string): AuthorizationStart {
    const web = connection.config.clientType === GoogleClientType.Web;

    if (web && !this.publicUrl) {
      throw new HuginnError(
        ErrorCode.Validation,
        'A Web client needs HUGINN_PUBLIC_URL; set it, or use a Desktop client'
      );
    }

    const redirectUri = web ? `${this.publicUrl}${OAUTH_CALLBACK_PATH}` : DESKTOP_REDIRECT;

    return {
      url: this.oauth.authorizationUrl({
        clientId: secrets.clientId ?? '',
        redirectUri,
        scopes: GMAIL_SCOPES,
        state,
      }),
      redirectUri,
      mode: web ? AuthorizationMode.Redirect : AuthorizationMode.PasteBack,
    };
  }

  public async complete(
    _connection: Connection,
    secrets: Secrets,
    code: string,
    redirectUri: string
  ): Promise<Secrets> {
    const refreshToken = await this.oauth.exchangeCode(
      { clientId: secrets.clientId ?? '', clientSecret: secrets.clientSecret ?? '' },
      code,
      redirectUri
    );

    return { refreshToken };
  }
}
