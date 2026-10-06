import type { IGoogleOAuthClient } from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';
import type { Secrets } from '@/core/connections/Connection.types';
import type { IConnectorAuthorization, SignInResult } from '@/core/connectors/Connector.types';
import type { SignInApp } from '@/core/oauth/OAuthApp.types';
import { OAuthProvider } from '@/core/oauth/OAuthApp.types';

/**
 * `gmail.modify` covers read, send, drafts and marking read; it cannot permanently
 * delete mail. `openid email` only tells Huginn which address signed in.
 */
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.modify',
] as const;

export class GoogleAuthorization implements IConnectorAuthorization {
  public readonly provider = OAuthProvider.Google;

  constructor(private readonly oauth: IGoogleOAuthClient) {}

  public isAuthorized(secrets: Secrets): boolean {
    return Boolean(secrets.refreshToken);
  }

  public authorizationUrl(app: SignInApp, state: string): string {
    return this.oauth.authorizationUrl({
      clientId: app.clientId,
      redirectUri: app.redirectUri,
      scopes: GMAIL_SCOPES,
      state,
    });
  }

  public async complete(app: SignInApp, code: string): Promise<SignInResult> {
    const grant = await this.oauth.exchangeCode(app, code, app.redirectUri);

    return { secrets: { refreshToken: grant.refreshToken }, account: grant.email };
  }
}
