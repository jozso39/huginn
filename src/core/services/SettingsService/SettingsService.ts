import { z } from 'zod';
import type { Logger } from '@/lib/logger';
import { emojiKey, emojiOf, isShortName, shortNameOf } from '@/core/emoji/emoji.utils';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { DEFAULT_QUICK_REACTIONS, MAX_QUICK_REACTIONS } from '@/core/settings/quickReactions';
import type { ISettingsStore, Settings, SettingsPatch } from '@/core/settings/Settings.types';
import { Theme } from '@/core/settings/Settings.types';
import type { ISettingsService } from './SettingsService.types';

const KEY = 'preferences';

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
  constructor(
    private readonly logger: Logger,
    private readonly store: ISettingsStore
  ) {}

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
