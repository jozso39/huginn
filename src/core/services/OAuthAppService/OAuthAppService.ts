import type { Logger } from '@/lib/logger';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type {
  IOAuthAppStore,
  OAuthAppCredentials,
  OAuthAppView,
} from '@/core/oauth/OAuthApp.types';
import { OAuthProvider, RedirectMode } from '@/core/oauth/OAuthApp.types';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { IOAuthAppService, OAuthAppUpdate } from './OAuthAppService.types';

export const OAUTH_CALLBACK_PATH = '/api/oauth/callback';

export interface OAuthAppServiceConfig {
  /** Where the browser reaches Huginn; without it no redirect can come back. */
  readonly publicUrl: string | null;
  /** The relay page, if one is deployed. */
  readonly relayUrl: string | null;
  /** Every port this Huginn may listen on, for providers that redirect to this machine. */
  readonly ports: readonly number[];
}

/**
 * Public clients sign in with PKCE and no secret, back to `http://localhost:<port>` (Slack
 * accepts nothing else for desktop apps, and only exact ports).
 */
const PUBLIC_CLIENTS: ReadonlySet<OAuthProvider> = new Set([OAuthProvider.Slack]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export class OAuthAppService implements IOAuthAppService {
  constructor(
    private readonly logger: Logger,
    private readonly store: IOAuthAppStore,
    private readonly secretBox: ISecretBox,
    private readonly config: OAuthAppServiceConfig
  ) {}

  public async view(provider: OAuthProvider): Promise<OAuthAppView> {
    const stored = await this.store.get(provider);

    if (PUBLIC_CLIENTS.has(provider)) {
      return {
        provider,
        configured: stored !== null,
        clientId: stored?.clientId ?? null,
        redirectMode: RedirectMode.Direct,
        redirectUris: { [RedirectMode.Direct]: this.loopbackUri(), [RedirectMode.Relay]: null },
        needsSecret: false,
        registerUris: this.config.ports.map(
          (port) => `http://localhost:${port}${OAUTH_CALLBACK_PATH}`
        ),
      };
    }

    const redirectMode = this.usableMode(stored?.redirectMode);

    return {
      provider,
      configured: stored !== null,
      clientId: stored?.clientId ?? null,
      redirectMode,
      redirectUris: {
        [RedirectMode.Direct]: this.redirectUri(RedirectMode.Direct),
        [RedirectMode.Relay]: this.redirectUri(RedirectMode.Relay),
      },
      needsSecret: true,
      registerUris: this.urisToRegister(redirectMode),
    };
  }

  public async save(provider: OAuthProvider, update: OAuthAppUpdate): Promise<OAuthAppView> {
    const stored = await this.store.get(provider);

    if (PUBLIC_CLIENTS.has(provider)) {
      if (!this.loopbackUri()) {
        throw new HuginnError(
          ErrorCode.Validation,
          `${provider} sign-in works only in the Huginn app on this Mac`
        );
      }

      // Nothing secret to keep: the client ID is all a PKCE sign-in needs.
      await this.store.save({
        provider,
        clientId: update.clientId,
        redirectMode: RedirectMode.Direct,
        secretCiphertext: '',
      });
      this.logger.info({ provider }, 'oauth app saved');

      return this.view(provider);
    }

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
    if (!stored) {
      return null;
    }

    if (PUBLIC_CLIENTS.has(provider)) {
      return {
        provider,
        clientId: stored.clientId,
        clientSecret: '',
        redirectUri: this.loopbackUri(),
      };
    }

    return {
      provider,
      clientId: stored.clientId,
      clientSecret: await this.secretBox.open(stored.secretCiphertext),
      redirectUri: this.redirectUri(this.usableMode(stored.redirectMode)),
    };
  }

  /** This Huginn's own port on `localhost`; null when it is not on this machine. */
  private loopbackUri(): string | null {
    if (!this.config.publicUrl) {
      return null;
    }

    const url = new URL(this.config.publicUrl);

    return LOOPBACK_HOSTS.has(url.hostname)
      ? `http://localhost:${url.port || '80'}${OAUTH_CALLBACK_PATH}`
      : null;
  }

  private defaultMode(): RedirectMode {
    return this.config.relayUrl ? RedirectMode.Relay : RedirectMode.Direct;
  }

  /**
   * The saved way back when this Huginn can use it, else the one it can: a setup saved for
   * the relay page signs in straight back in the Mac app, which has no relay.
   */
  private usableMode(saved: RedirectMode | undefined): RedirectMode {
    return saved && this.redirectUri(saved) ? saved : this.defaultMode();
  }

  /**
   * What the provider must list as redirect URIs. On this Mac that is one per port Huginn
   * may take (it falls back to the next when its own is busy).
   */
  private urisToRegister(mode: RedirectMode): string[] {
    const uri = this.redirectUri(mode);

    if (!uri || mode !== RedirectMode.Direct || !this.loopbackUri() || !this.config.publicUrl) {
      return uri ? [uri] : [];
    }

    const url = new URL(this.config.publicUrl);

    return this.config.ports.map((port) => {
      url.port = String(port);

      return `${url.origin}${OAUTH_CALLBACK_PATH}`;
    });
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
