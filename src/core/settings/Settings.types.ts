export enum Theme {
  /** Follows macOS: light by day, dark at night if the Mac does. */
  System = 'System',
  Light = 'Light',
  Dark = 'Dark',
}

/** The user's preferences for the whole app. */
export interface Settings {
  readonly theme: Theme;
  /** The emoji offered as one-click reactions, in this order ("👍", "🫥"). */
  readonly quickReactions: readonly string[];
}

export type SettingsPatch = Partial<Settings>;

export interface ISettingsStore {
  /** The stored value, or undefined when it was never set. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
