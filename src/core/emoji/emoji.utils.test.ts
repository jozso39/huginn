import { describe, expect, test } from 'bun:test';
import { emojiOf, isShortName, shortNameOf, splitEmoji } from './emoji.utils';

describe('emoji.utils', () => {
  test('knows the names Slack uses, with or without the emoji selector', () => {
    expect(shortNameOf('👍')).toBe('+1');
    expect(shortNameOf('🫥')).toBe('dotted_line_face');
    expect(shortNameOf('❤️')).toBe('heart');
    expect(shortNameOf('❤')).toBe('heart');
    expect(shortNameOf('🧑‍💻')).toBe('technologist');
  });

  test('skin tones become Slack’s ::skin-tone-N and back', () => {
    expect(shortNameOf('👍🏽')).toBe('+1::skin-tone-4');
    expect(emojiOf('+1::skin-tone-4')).toBe('👍🏽');
    expect(emojiOf('thumbsup')).toBe('👍');
  });

  test('anything else is not an emoji', () => {
    expect(shortNameOf('a')).toBeNull();
    expect(shortNameOf('👍👍')).toBeNull();
    expect(emojiOf('parrot_party')).toBeNull();
  });

  test('a typed row splits into emoji, ignoring spaces and commas', () => {
    expect(splitEmoji('✅🫥 👍🏽, ❤️')).toEqual({
      emoji: ['✅', '🫥', '👍🏽', '❤️'],
      rejected: [],
    });
    expect(splitEmoji('✅ ok')).toEqual({ emoji: ['✅'], rejected: ['o', 'k'] });
  });

  test('short names are told apart from emoji', () => {
    expect(isShortName('eyes')).toBe(true);
    expect(isShortName('+1::skin-tone-2')).toBe(true);
    expect(isShortName('👀')).toBe(false);
  });
});
