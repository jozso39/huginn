import type {
  OAuthAppCredentials,
  OAuthAppView,
  OAuthProvider,
  RedirectMode,
} from '@/core/oauth/OAuthApp.types';

export interface OAuthAppUpdate {
  readonly clientId: string;
  /** Empty keeps the stored secret, so the form never has to show it. */
  readonly clientSecret: string;
  readonly redirectMode: RedirectMode;
}

/** The one OAuth client per provider that every connection of that provider signs in with. */
export interface IOAuthAppService {
  view(provider: OAuthProvider): Promise<OAuthAppView>;
  save(provider: OAuthProvider, update: OAuthAppUpdate): Promise<OAuthAppView>;
  /** Null until the app is set up. */
  credentials(provider: OAuthProvider): Promise<OAuthAppCredentials | null>;
}
