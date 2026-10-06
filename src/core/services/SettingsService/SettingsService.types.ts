import type { AiKeyInfo, AiProvider, IAiKeySource } from '@/core/settings/AiKey.types';
import type { Settings, SettingsPatch } from '@/core/settings/Settings.types';

/** Preferences, and the AI key the model clients read (`credentials()`). */
export interface ISettingsService extends IAiKeySource {
  /** At boot: loads the AI key, so the model clients know at once whether there is one. */
  start(): Promise<void>;
  get(): Promise<Settings>;
  /** Changes what is given; the rest stays. Quick reactions must be emoji Slack knows. */
  update(patch: SettingsPatch): Promise<Settings>;
  /** Which key is set, if any; the key itself never leaves the service. */
  aiKey(): AiKeyInfo | null;
  /** Checks the key with its provider, then keeps it sealed. Replaces any earlier one. */
  setAiKey(provider: AiProvider, apiKey: string): Promise<AiKeyInfo>;
  removeAiKey(): Promise<void>;
}
