import type {
  GoogleAccessToken,
  GoogleAuthorizationRequest,
  GoogleClientCredentials,
  GoogleGrant,
  IGoogleOAuthClient,
} from '@/core/clients/GoogleOAuthClient/GoogleOAuthClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface TokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
  readonly error_description?: string;
}

export class GoogleOAuthClient implements IGoogleOAuthClient {
  constructor(private readonly timeoutMs: number) {}

  public authorizationUrl(request: GoogleAuthorizationRequest): string {
    const params = new URLSearchParams({
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      response_type: 'code',
      scope: request.scopes.join(' '),
      state: request.state,
      // offline + consent: the only combination that reliably returns a refresh
      // token, also when this Google account signed in to the same client before.
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${AUTH_URL}?${params.toString()}`;
  }

  public async exchangeCode(
    credentials: GoogleClientCredentials,
    code: string,
    redirectUri: string
  ): Promise<GoogleGrant> {
    const response = await this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });

    if (!response.refresh_token) {
      throw new HuginnError(
        ErrorCode.Upstream,
        'Google returned no refresh token — remove Huginn under myaccount.google.com → Security → Third-party access, then sign in again'
      );
    }

    return { refreshToken: response.refresh_token, email: GoogleOAuthClient.emailOf(response) };
  }

  /**
   * The ID token came straight from Google's token endpoint over TLS, so its payload
   * can be read without verifying the signature (Google's own guidance for this case).
   */
  private static emailOf(response: TokenResponse): string {
    const payload = response.id_token?.split('.')[1];
    const claims = payload
      ? (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string })
      : {};

    if (!claims.email) {
      throw new HuginnError(ErrorCode.Upstream, 'Google did not say which account signed in');
    }

    return claims.email;
  }

  public async accessToken(
    credentials: GoogleClientCredentials,
    refreshToken: string
  ): Promise<GoogleAccessToken> {
    const response = await this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });

    if (!response.access_token) {
      throw new HuginnError(ErrorCode.Upstream, 'Google returned no access token');
    }

    return {
      token: response.access_token,
      expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    };
  }

  private async token(form: Record<string, string>): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as TokenResponse;

    if (!response.ok) {
      // invalid_grant = revoked, expired or already-used code: the user must sign in again.
      const code = body.error === 'invalid_grant' ? ErrorCode.Unauthorized : ErrorCode.Upstream;

      throw new HuginnError(
        code,
        `Google sign-in: ${body.error ?? response.status}${body.error_description ? ` — ${body.error_description}` : ''}`
      );
    }

    return body;
  }
}
