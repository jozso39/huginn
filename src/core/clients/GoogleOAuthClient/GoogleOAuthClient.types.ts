export interface GoogleClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface GoogleAuthorizationRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly state: string;
}

export interface GoogleAccessToken {
  readonly token: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/** Google's OAuth 2.0 endpoints, nothing Gmail-specific. */
export interface IGoogleOAuthClient {
  authorizationUrl(request: GoogleAuthorizationRequest): string;
  /** Returns the refresh token; Google only issues one when consent was just given. */
  exchangeCode(
    credentials: GoogleClientCredentials,
    code: string,
    redirectUri: string
  ): Promise<string>;
  accessToken(
    credentials: GoogleClientCredentials,
    refreshToken: string
  ): Promise<GoogleAccessToken>;
}
