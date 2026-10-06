/** A user's Slack tokens. PKCE sign-ins get rotating ones: access ~12 h, refresh 30 days. */
export interface SlackTokens {
  readonly accessToken: string;
  /** Null for tokens that never expire (apps without rotation). */
  readonly refreshToken: string | null;
  /** Epoch ms; null when it does not expire. */
  readonly expiresAt: number | null;
}

/** What a sign-in gives: the person's tokens and who they are. */
export interface SlackGrant extends SlackTokens {
  readonly userId: string;
  readonly teamId: string;
  readonly teamName: string;
}

/** Slack's `oauth.v2.access` for a public client: PKCE instead of a client secret. */
export interface ISlackOAuthClient {
  exchangeCode(request: {
    readonly clientId: string;
    readonly code: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }): Promise<SlackGrant>;
  /** A new pair of tokens; the old refresh token stops working. */
  refresh(request: {
    readonly clientId: string;
    readonly refreshToken: string;
  }): Promise<SlackTokens>;
}
