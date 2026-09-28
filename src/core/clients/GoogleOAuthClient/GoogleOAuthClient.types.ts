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

export interface GoogleGrant {
  readonly refreshToken: string;
  /** From the ID token; needs the `openid email` scopes in the request. */
  readonly email: string;
}

/** Google's OAuth 2.0 endpoints, nothing product-specific. */
export interface IGoogleOAuthClient {
  authorizationUrl(request: GoogleAuthorizationRequest): string;
  exchangeCode(
    credentials: GoogleClientCredentials,
    code: string,
    redirectUri: string
  ): Promise<GoogleGrant>;
  accessToken(
    credentials: GoogleClientCredentials,
    refreshToken: string
  ): Promise<GoogleAccessToken>;
}
