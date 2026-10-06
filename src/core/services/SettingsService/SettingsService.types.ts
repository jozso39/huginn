import type { Settings, SettingsPatch } from '@/core/settings/Settings.types';

export interface ISettingsService {
  get(): Promise<Settings>;
  /** Changes what is given; the rest stays. Quick reactions must be emoji Slack knows. */
  update(patch: SettingsPatch): Promise<Settings>;
}
