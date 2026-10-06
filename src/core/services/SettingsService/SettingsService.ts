import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import { emojiKey, emojiOf, isShortName, shortNameOf } from '@/core/emoji/emoji.utils';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import type { ISecretBox } from '@/core/secrets/SecretBox.types';
import type { AiCredentials, AiKeyInfo, IAiKeyChecker } from '@/core/settings/AiKey.types';
import { AiProvider } from '@/core/settings/AiKey.types';
import { DEFAULT_QUICK_REACTIONS, MAX_QUICK_REACTIONS } from '@/core/settings/quickReactions';
import type { ISettingsStore, Settings, SettingsPatch } from '@/core/settings/Settings.types';
import { Theme } from '@/core/settings/Settings.types';
import type { ISettingsService } from './SettingsService.types';

const KEY = 'preferences';
const AI_KEY = 'aiKey';

// The AI key as stored: sealed with the master key, plus what may be shown about it.
const storedAiKeySchema = z.object({
  provider: z.enum(AiProvider),
  ciphertext: z.string().min(1),
  hint: z.string(),
  savedAt: z.number(),
});

/** A stored reaction as an emoji; short names from older settings are turned into one. */
const asEmoji = (stored: string): string | null =>
  isShortName(stored) ? emojiOf(stored) : shortNameOf(stored) ? stored : null;

// Whatever an older or newer version stored: what is still valid stays, the rest
// falls back to the defaults.
const storedSchema = z
  .object({
    theme: z.enum(Theme).catch(Theme.System),
    quickReactions: z
      .array(z.string())
      .catch([])
      .transform((stored) => stored.map(asEmoji).filter((emoji) => emoji !== null))
      .transform((emoji) => (emoji.length > 0 ? emoji : [...DEFAULT_QUICK_REACTIONS])),
  })
  .catch({ theme: Theme.System, quickReactions: [...DEFAULT_QUICK_REACTIONS] });

export class SettingsService implements ISettingsService {
  // Kept opened in memory: the model clients ask on every call and must not wait.
  private ai: { readonly info: AiKeyInfo; readonly credentials: AiCredentials } | null = null;

  constructor(
    private readonly logger: Logger,
    private readonly store: ISettingsStore,
    private readonly secretBox: ISecretBox,
    private readonly checker: IAiKeyChecker
  ) {}

  public async start(): Promise<void> {
    const stored = storedAiKeySchema.safeParse(await this.store.get(AI_KEY));

    if (!stored.success) {
      this.ai = null;

      return;
    }

    const { provider, ciphertext, hint, savedAt } = stored.data;

    try {
      this.ai = {
        info: { provider, hint, savedAt: new Date(savedAt) },
        credentials: { provider, apiKey: await this.secretBox.open(ciphertext) },
      };
    } catch (error) {
      // Sealed with another master key: as good as none; the user enters it again.
      this.logger.warn({ err: toError(error) }, 'the stored AI key cannot be opened');
      this.ai = null;
    }
  }

  public credentials(): AiCredentials | null {
    return this.ai?.credentials ?? null;
  }

  public aiKey(): AiKeyInfo | null {
    return this.ai?.info ?? null;
  }

  public async setAiKey(provider: AiProvider, apiKey: string): Promise<AiKeyInfo> {
    const key = apiKey.trim();

    if (key.length < 16 || /\s/.test(key)) {
      throw new HuginnError(ErrorCode.Validation, 'That does not look like an API key');
    }

    await this.checker.check({ provider, apiKey: key });

    const info: AiKeyInfo = { provider, hint: key.slice(-4), savedAt: new Date() };

    await this.store.set(AI_KEY, {
      provider,
      ciphertext: await this.secretBox.seal(key),
      hint: info.hint,
      savedAt: info.savedAt.getTime(),
    });
    this.ai = { info, credentials: { provider, apiKey: key } };
    this.logger.info({ provider }, 'AI key saved');

    return info;
  }

  public async removeAiKey(): Promise<void> {
    await this.store.remove(AI_KEY);
    this.ai = null;
    this.logger.info('AI key removed');
  }

  public async get(): Promise<Settings> {
    return storedSchema.parse((await this.store.get(KEY)) ?? {});
  }

  public async update(patch: SettingsPatch): Promise<Settings> {
    if (patch.quickReactions) {
      SettingsService.assertReactions(patch.quickReactions);
    }

    const next: Settings = { ...(await this.get()), ...patch };

    await this.store.set(KEY, next);
    this.logger.info({ changed: Object.keys(patch) }, 'settings changed');

    return next;
  }

  /** Each one an emoji Slack has a name for (Signal takes any), once, and a row's worth. */
  private static assertReactions(reactions: readonly string[]): void {
    const rejected = reactions.filter((emoji) => shortNameOf(emoji) === null);

    if (rejected.length > 0) {
      throw new HuginnError(
        ErrorCode.Validation,
        `Not an emoji Huginn can react with: ${rejected.join(' ')}`
      );
    }

    const keys = reactions.map(emojiKey);
    const repeated = reactions.filter((_, index) => keys.indexOf(keys[index] ?? '') !== index);

    if (repeated.length > 0) {
      throw new HuginnError(ErrorCode.Validation, `Each emoji only once: ${repeated.join(' ')}`);
    }

    if (reactions.length === 0 || reactions.length > MAX_QUICK_REACTIONS) {
      throw new HuginnError(
        ErrorCode.Validation,
        `Between 1 and ${MAX_QUICK_REACTIONS} quick reactions`
      );
    }
  }
}
