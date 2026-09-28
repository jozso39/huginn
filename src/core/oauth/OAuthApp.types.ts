/** A provider whose sign-in several connectors can share (Gmail, later Calendar, Drive…). */
export enum OAuthProvider {
  Google = 'Google',
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

/** Everything a sign-in needs, secret included. Never leaves the server. */
export interface OAuthAppCredentials {
  readonly provider: OAuthProvider;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** What the settings page may show: no secret. */
export interface OAuthAppView {
  readonly provider: OAuthProvider;
  readonly configured: boolean;
  readonly clientId: string | null;
  readonly redirectMode: RedirectMode;
  /** The URI to register with the provider for each mode; null when it cannot work. */
  readonly redirectUris: Readonly<Record<RedirectMode, string | null>>;
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
