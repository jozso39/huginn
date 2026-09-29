import { describe, expect, test } from 'bun:test';
import { messageText, readMessageIds, withMentions } from './SignalConnector.utils';

describe('Signal message text', () => {
  test('mention marks become @names, right to left so offsets hold', () => {
    const text = '￼ and ￼, lunch?';
    const mentions = [
      { name: 'Jana', start: 0, length: 1 },
      { number: '+420600000009', start: 6, length: 1 },
    ];

    expect(withMentions(text, mentions)).toBe('@Jana and @+420600000009, lunch?');
  });

  test('reactions and deletions are not messages; attachments are noted', () => {
    expect(messageText({ timestamp: 1, reaction: { emoji: '👍' } })).toBeNull();
    expect(messageText({ timestamp: 1, remoteDelete: { timestamp: 0 } })).toBeNull();
    expect(messageText({ timestamp: 1, message: '' })).toBeNull();
    expect(
      messageText({ timestamp: 1, message: 'look', attachments: [{ contentType: 'image/jpeg' }] })
    ).toBe('[image] look');
    expect(messageText({ timestamp: 1, sticker: {} })).toBe('[sticker]');
  });

  test('a read receipt from the phone matches by uuid or number', () => {
    expect(
      readMessageIds([{ senderUuid: 'u1', senderNumber: '+420600000002', timestamp: 5 }])
    ).toEqual(['5:u1', '5:+420600000002']);
  });
});
