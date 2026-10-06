import type {
  ISlackOAuthClient,
  SlackGrant,
  SlackTokens,
} from '@/core/clients/SlackOAuthClient/SlackOAuthClient.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';

const ACCESS_URL = 'https://slack.com/api/oauth.v2.access';

interface AccessResponse {
  readonly ok: boolean;
  readonly error?: string;
  /** Sign-in: the person's tokens sit under authed_user (user scopes only). */
  readonly authed_user?: {
    readonly id?: string;
    readonly access_token?: string;
    readonly refresh_token?: string;
    readonly expires_in?: number;
  };
  readonly team?: { readonly id?: string; readonly name?: string };
  /** Refresh: the new pair sits at the top level. */
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
}

const expiresAt = (seconds: number | undefined): number | null =>
  seconds ? Date.now() + seconds * 1000 : null;

/** Slack's token endpoint for a PKCE (public) client: never a client secret. */
export class SlackOAuthClient implements ISlackOAuthClient {
  constructor(private readonly timeoutMs: number) {}

  public async exchangeCode(request: {
    readonly clientId: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }): Promise<SlackGrant> {
    const response = await this.post({
      client_id: request.clientId,
      code: request.code,
      code_verifier: request.codeVerifier,
      redirect_uri: request.redirectUri,
    });
    const user = response.authed_user;

    if (!user?.access_token || !user.id || !response.team?.id) {
      throw new HuginnError(ErrorCode.Upstream, 'Slack signed in, but sent no user token');
    }

    return {
      accessToken: user.access_token,
      refreshToken: user.refresh_token ?? null,
      expiresAt: expiresAt(user.expires_in),
      userId: user.id,
      teamId: response.team.id,
      teamName: response.team.name ?? 'Slack',
    };
  }

  public async refresh(request: {
    readonly clientId: string;
    readonly refreshToken: string;
  }): Promise<SlackTokens> {
    const response = await this.post({
      grant_type: 'refresh_token',
      client_id: request.clientId,
      refresh_token: request.refreshToken,
    });
    const accessToken = response.access_token ?? response.authed_user?.access_token;

    if (!accessToken) {
      throw new HuginnError(ErrorCode.Upstream, 'Slack refreshed, but sent no token');
    }

    return {
      accessToken,
      refreshToken: response.refresh_token ?? response.authed_user?.refresh_token ?? null,
      expiresAt: expiresAt(response.expires_in ?? response.authed_user?.expires_in),
    };
  }

  private async post(form: Record<string, string>): Promise<AccessResponse> {
    const response = await fetch(ACCESS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      throw new HuginnError(ErrorCode.Upstream, `Slack: ${toError(error).message}`);
    });
    const body = (await response.json().catch(() => ({ ok: false }))) as AccessResponse;

    if (!body.ok) {
      const error = body.error ?? `HTTP ${response.status}`;

      // A dead refresh token (30 days unused, or revoked) means signing in again.
      throw new HuginnError(
        /invalid_refresh_token|invalid_grant|invalid_code|token_revoked/.test(error)
          ? ErrorCode.Unauthorized
          : ErrorCode.Upstream,
        `Slack sign-in: ${error}`
      );
    }

    return body;
  }
}
