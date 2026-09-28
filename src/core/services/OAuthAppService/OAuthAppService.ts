import type { Logger } from '@/lib/logger';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type {
  IOAuthAppStore,
  OAuthAppCredentials,
  OAuthAppView,
  OAuthProvider,
} from '@/core/oauth/OAuthApp.types';
import { RedirectMode } from '@/core/oauth/OAuthApp.types';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IOAuthAppService, OAuthAppUpdate } from './OAuthAppService.types';

export const OAUTH_CALLBACK_PATH = '/api/oauth/callback';

export interface OAuthAppServiceConfig {
  /** Where the browser reaches Huginn; without it no redirect can come back. */
  readonly publicUrl: string | null;
  /** The relay page, if one is deployed. */
  readonly relayUrl: string | null;
}

export class OAuthAppService implements IOAuthAppService {
  constructor(
    private readonly logger: Logger,
    private readonly store: IOAuthAppStore,
    private readonly secretBox: ISecretBox,
    private readonly config: OAuthAppServiceConfig
  ) {}

  public async view(provider: OAuthProvider): Promise<OAuthAppView> {
    const stored = await this.store.get(provider);

    return {
      provider,
      configured: stored !== null,
      clientId: stored?.clientId ?? null,
      redirectMode: stored?.redirectMode ?? this.defaultMode(),
      redirectUris: {
        [RedirectMode.Direct]: this.redirectUri(RedirectMode.Direct),
        [RedirectMode.Relay]: this.redirectUri(RedirectMode.Relay),
      },
    };
  }

  public async save(provider: OAuthProvider, update: OAuthAppUpdate): Promise<OAuthAppView> {
    const stored = await this.store.get(provider);

    if (!this.redirectUri(update.redirectMode)) {
      throw new HuginnError(
        ErrorCode.Validation,
        update.redirectMode === RedirectMode.Relay
          ? 'Relay needs HUGINN_OAUTH_RELAY_URL and HUGINN_PUBLIC_URL'
          : 'Direct needs HUGINN_PUBLIC_URL'
      );
    }

    if (!stored && update.clientSecret === '') {
      throw new HuginnError(ErrorCode.Validation, 'The client secret is required the first time');
    }

    await this.store.save({
      provider,
      clientId: update.clientId,
      redirectMode: update.redirectMode,
      secretCiphertext:
        update.clientSecret === ''
          ? (stored?.secretCiphertext ?? '')
          : await this.secretBox.seal(update.clientSecret),
    });
    this.logger.info({ provider, redirectMode: update.redirectMode }, 'oauth app saved');

    return this.view(provider);
  }

  public async credentials(provider: OAuthProvider): Promise<OAuthAppCredentials | null> {
    const stored = await this.store.get(provider);
    const redirectUri = stored ? this.redirectUri(stored.redirectMode) : null;

    if (!stored || !redirectUri) {
      return null;
    }

    return {
      provider,
      clientId: stored.clientId,
      clientSecret: await this.secretBox.open(stored.secretCiphertext),
      redirectUri,
    };
  }

  private defaultMode(): RedirectMode {
    return this.config.relayUrl ? RedirectMode.Relay : RedirectMode.Direct;
  }

  private redirectUri(mode: RedirectMode): string | null {
    if (!this.config.publicUrl) {
      return null;
    }

    return mode === RedirectMode.Relay
      ? this.config.relayUrl
      : `${this.config.publicUrl}${OAUTH_CALLBACK_PATH}`;
  }
}
