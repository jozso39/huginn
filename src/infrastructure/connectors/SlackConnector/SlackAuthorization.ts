import type { ISlackOAuthClient } from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';
import type { Secrets } from '@/core/connections/Connection.types';
import type { IConnectorAuthorization, SignInResult } from '@/core/connectors/Connector.types';
import type { SignInApp } from '@/core/oauth/OAuthApp.types';
import { OAuthProvider } from '@/core/oauth/OAuthApp.types';

/**
 * What Huginn asks of each person, as them (user scopes only: a desktop sign-in may not
 * ask for bot scopes). Search finds what is new; the rest reads names, answers and reacts.
 */
export const SLACK_USER_SCOPES = [
  'search:read', // what is new since the last check: DMs, mentions, threads, channels
  'channels:history', // a message in full when search leaves something out
  'groups:history',
  'im:history',
  'mpim:history',
  'channels:read', // channel names for titles, "read in Slack" markers
  'groups:read',
  'im:read',
  'mpim:read',
  'users:read', // people's names instead of U-IDs
  'usergroups:read', // @group mentions of groups you are in
  'chat:write', // reply as you
  'reactions:write', // emoji as you
] as const;

/** "Sign in with Slack": PKCE against the company's own app, no client secret. */
export class SlackAuthorization implements IConnectorAuthorization {
  public readonly provider = OAuthProvider.Slack;

  constructor(private readonly oauth: ISlackOAuthClient) {}

  public isAuthorized(secrets: Secrets): boolean {
    return Boolean(secrets.userToken);
  }

  public authorizationUrl(app: SignInApp, state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: app.clientId,
      user_scope: SLACK_USER_SCOPES.join(','),
      redirect_uri: app.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  public async complete(app: SignInApp, code: string, codeVerifier: string): Promise<SignInResult> {
    const grant = await this.oauth.exchangeCode({
      clientId: app.clientId,
      code,
      codeVerifier,
      redirectUri: app.redirectUri,
    });

    return {
      secrets: {
        userToken: grant.accessToken,
        ...(grant.refreshToken ? { refreshToken: grant.refreshToken } : {}),
        ...(grant.expiresAt ? { expiresAt: String(grant.expiresAt) } : {}),
      },
      // Stable whatever the person is called: signing in again finds this connection.
      account: `${grant.teamId}:${grant.userId}`,
      name: `${grant.teamName} Slack`,
    };
  }
}
