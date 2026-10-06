/** A provider whose sign-in several connectors can share (Gmail, later Calendar, Drive…). */
export enum OAuthProvider {
  Google = 'Google',
  /**
   * A company's own Slack app, signed in to with PKCE: no client secret, so its client
   * ID can be handed to colleagues; each person's token reads only what they can see.
   */
  Slack = 'Slack',
}

/** How the provider gets the browser back to Huginn after sign-in. */
export enum RedirectMode {
  /** Straight to HUGINN_PUBLIC_URL; the provider must accept that domain. */
  Direct = 'Direct',
  /**
   * Via a static page on a domain the provider already trusts, which forwards the
   * one-time code to HUGINN_PUBLIC_URL. The code is useless without the client
   * secret, which never leaves Huginn.
   */
  Relay = 'Relay',
}

/** The provider app, secret included. Never leaves the server. */
export interface OAuthAppCredentials {
  readonly provider: OAuthProvider;
  readonly clientId: string;
  /** Empty for public clients (Slack with PKCE), which have none. */
  readonly clientSecret: string;
  /**
   * Where the provider sends the browser after a sign-in; null when this Huginn has no
   * address for the chosen mode. Refreshing tokens does not need it — only signing in.
   */
  readonly redirectUri: string | null;
}

/** The app as a sign-in needs it: with somewhere to come back to. */
export type SignInApp = OAuthAppCredentials & { readonly redirectUri: string };

/** What the settings page may show: no secret. */
export interface OAuthAppView {
  readonly provider: OAuthProvider;
  readonly configured: boolean;
  readonly clientId: string | null;
  readonly redirectMode: RedirectMode;
  /** The URI to register with the provider for each mode; null when it cannot work. */
  readonly redirectUris: Readonly<Record<RedirectMode, string | null>>;
  /** Whether the provider app has a secret to enter (Slack with PKCE has none). */
  readonly needsSecret: boolean;
  /** Every redirect URI to register with the provider (Slack: one per port Huginn may use). */
  readonly registerUris: readonly string[];
}

export interface StoredOAuthApp {
  readonly provider: OAuthProvider;
  readonly clientId: string;
  readonly redirectMode: RedirectMode;
  readonly secretCiphertext: string;
}

export interface IOAuthAppStore {
  get(provider: OAuthProvider): Promise<StoredOAuthApp | null>;
  save(app: StoredOAuthApp): Promise<void>;
}
