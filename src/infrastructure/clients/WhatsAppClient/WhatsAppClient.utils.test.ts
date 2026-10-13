import { describe, expect, test } from 'bun:test';
import { contextOf, messageText, phoneOf, withNames } from './WhatsAppClient.utils';

describe('a WhatsApp message as text', () => {
  test('text is text, with or without a link preview', () => {
    expect(messageText({ conversation: 'Hi!' })).toEqual({ text: 'Hi!', hasMedia: false });
    expect(messageText({ extendedTextMessage: { text: 'See https://x.cz' } })).toEqual({
      text: 'See https://x.cz',
      hasMedia: false,
    });
  });

  test('media becomes a note, with its caption', () => {
    expect(messageText({ imageMessage: { caption: 'Look at this' } })?.text).toBe(
      '[photo] Look at this'
    );
    expect(messageText({ imageMessage: {} })).toEqual({ text: '[photo]', hasMedia: true });
    expect(messageText({ videoMessage: { gifPlayback: true } })?.text).toBe('[GIF]');
    expect(messageText({ audioMessage: { ptt: true } })?.text).toBe('[voice message]');
    expect(messageText({ documentMessage: { fileName: 'invoice.pdf' } })?.text).toBe(
      '[file] invoice.pdf'
    );
    expect(messageText({ stickerMessage: {} })?.text).toBe('[sticker]');
  });

  test('places, contacts, polls and events say what they are', () => {
    expect(messageText({ locationMessage: { name: 'Karlín' } })).toEqual({
      text: '[location] Karlín',
      hasMedia: false,
    });
    expect(messageText({ contactMessage: { displayName: 'Petra' } })?.text).toBe('[contact] Petra');
    expect(messageText({ pollCreationMessageV3: { name: 'Pizza or sushi?' } })?.text).toBe(
      '[poll] Pizza or sushi?'
    );
    expect(messageText({ eventMessage: { name: 'Birthday' } })?.text).toBe('[event] Birthday');
  });

  test('reactions, receipts and key exchanges are not messages to show', () => {
    expect(messageText({ reactionMessage: { text: '👍' } })).toBeNull();
    expect(messageText({ protocolMessage: {} })).toBeNull();
    expect(messageText({ senderKeyDistributionMessage: {} })).toBeNull();
    expect(messageText(null)).toBeNull();
  });
});

describe('mentions and numbers', () => {
  test('the context is found whatever kind of message carries it', () => {
    const context = { mentionedJid: ['420600000001@s.whatsapp.net'] };

    expect(contextOf({ extendedTextMessage: { text: 'x', contextInfo: context } })).toBe(context);
    expect(contextOf({ imageMessage: { contextInfo: context } })).toBe(context);
    expect(contextOf({ conversation: 'x' })).toBeNull();
  });

  test('@number becomes @Name', () => {
    expect(
      withNames('@420600000001 and @12345 can you drive?', [
        { user: '420600000001', name: 'Jozef' },
        { user: '12345', name: 'Petra' },
      ])
    ).toBe('@Jozef and @Petra can you drive?');
  });

  test('a number-based id gives the number; a hidden one gives nothing', () => {
    expect(phoneOf('420600000001@s.whatsapp.net')).toBe('+420600000001');
    expect(phoneOf('420600000001:12@s.whatsapp.net')).toBe('+420600000001');
    expect(phoneOf('123456789012345@lid')).toBeNull();
    expect(phoneOf(undefined)).toBeNull();
  });
});
