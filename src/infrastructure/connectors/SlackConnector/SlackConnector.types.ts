/**
 * Which channel messages come in, on top of DMs, mentions and replies in the user's
 * threads — those always come in. Slack does not expose mute settings to apps (the
 * prefs API needs a legacy scope new apps cannot get), so "all my channels" with an
 * ignore list is the closest thing to "everything I have not muted".
 */
export enum SlackChannelScope {
  AddressedToMe = 'AddressedToMe',
  AllMyChannels = 'AllMyChannels',
}

/** What happens to an item once the user has read the message in Slack. */
export enum SlackReadMode {
  Keep = 'Keep',
  Clear = 'Clear',
}

/** Channel lists as the user typed them: `#name`, `name` or an ID, comma-separated. */
export interface SlackChannelSettings {
  readonly scope: SlackChannelScope;
  readonly watch: readonly string[];
  readonly ignore: readonly string[];
  readonly whenRead: SlackReadMode;
}
