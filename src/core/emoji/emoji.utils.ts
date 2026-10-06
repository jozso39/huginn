import { EMOJI_TABLE } from './emojiTable';

// Text/emoji presentation selectors: "❤" and "❤️" are the same emoji.
const SELECTORS = /[︎️]/g;
// Fitzpatrick modifiers; Slack writes them as ::skin-tone-2 … ::skin-tone-6.
const SKIN_TONES = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const SHORT_NAME = /^[a-z0-9_+-]+(::skin-tone-[2-6])?$/;
// Between emoji in what someone typed: fine, and ignored.
const SEPARATOR = /^[\s,]+$/u;

/** One emoji, compared without its presentation selectors. */
export const emojiKey = (emoji: string): string => emoji.replace(SELECTORS, '');

const ENTRIES = EMOJI_TABLE.trim()
  .split(/[|\n]/)
  .map((entry) => {
    const [emoji = '', names = ''] = entry.split(':');

    return { emoji, names: names.split(',') };
  });
const NAME_BY_EMOJI = new Map(ENTRIES.map((entry) => [emojiKey(entry.emoji), entry.names[0]]));
const EMOJI_BY_NAME = new Map(
  ENTRIES.flatMap((entry) => entry.names.map((name) => [name, entry.emoji] as const))
);

/** "+1", "eyes", "+1::skin-tone-3": a short name as Slack writes it, rather than an emoji. */
export const isShortName = (text: string): boolean => SHORT_NAME.test(text);

/**
 * Slack's short name for one emoji: "👍" → "+1", "👍🏽" → "+1::skin-tone-4". Null when
 * it is not an emoji Slack knows, which is also what decides whether Huginn offers it.
 */
export const shortNameOf = (emoji: string): string | null => {
  const key = emojiKey(emoji);
  const direct = NAME_BY_EMOJI.get(key);

  if (direct) {
    return direct;
  }

  const tone = SKIN_TONES.findIndex((modifier) => key.includes(modifier));
  const base = tone >= 0 ? NAME_BY_EMOJI.get(key.replace(SKIN_TONES[tone] ?? '', '')) : undefined;

  return base ? `${base}::skin-tone-${tone + 2}` : null;
};

/** The emoji a short name stands for: "thumbsup" → "👍", "+1::skin-tone-4" → "👍🏽". */
export const emojiOf = (shortName: string): string | null => {
  const [name = '', tone] = shortName.split('::skin-tone-');
  const emoji = EMOJI_BY_NAME.get(name);

  if (!emoji) {
    return null;
  }

  if (tone === undefined) {
    return emoji;
  }

  const modifier = SKIN_TONES[Number(tone) - 2];

  // The modifier follows the base character directly, without a selector.
  return modifier ? `${emojiKey(emoji)}${modifier}` : null;
};

/**
 * A row of emoji as someone typed it ("✅🫥 👍"): the emoji in order, and every piece
 * that is not one. Spaces and commas between them are fine.
 */
export const splitEmoji = (
  text: string
): { readonly emoji: readonly string[]; readonly rejected: readonly string[] } => {
  const pieces = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)]
    .map((part) => part.segment)
    .filter((piece) => !SEPARATOR.test(piece));

  return {
    emoji: pieces.filter((piece) => shortNameOf(piece) !== null),
    rejected: pieces.filter((piece) => shortNameOf(piece) === null),
  };
};
