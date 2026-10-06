import { EMOJI_TABLE } from './emojiTable';

// Every emoji Slack knows by name (iamcal emoji-data, the set Slack uses), plus a few
// names people type that it does not have. Anything else — a workspace's custom emoji —
// is shown as :name:, which is what Slack's own plain-text rendering does too.
const EXTRAS: readonly (readonly [string, string])[] = [
  ['raven', '🐦‍⬛'],
  ['facepalm', '🤦'],
  ['salute', '🫡'],
];

const EMOJI: ReadonlyMap<string, string> = new Map([
  ...EXTRAS,
  ...EMOJI_TABLE.trim()
    .split(/[|\n]/)
    .flatMap((entry) => {
      const [char = '', names = ''] = entry.split(':');

      return names.split(',').map((name) => [name, char] as const);
    })
    .filter(([name, char]) => name !== '' && char !== ''),
]);

/** `thumbsup::skin-tone-3` → 👍🏽; unknown names → null (shown as :name:). */
export const emojiFor = (shortcode: string): string | null => {
  const [name = '', tone] = shortcode.split('::');
  const base = EMOJI.get(name);
  const tones: Record<string, string> = {
    'skin-tone-2': '🏻',
    'skin-tone-3': '🏼',
    'skin-tone-4': '🏽',
    'skin-tone-5': '🏾',
    'skin-tone-6': '🏿',
  };

  return base ? (tone ? `${base.replace(/\uFE0F/g, '')}${tones[tone] ?? ''}` : base) : null;
};
