import { describe, expect, test } from 'bun:test';
import { ItemKind } from '@/core/items/Item.types';
import {
  MOCK_GMAIL_MESSAGE,
  MOCK_MAILBOX,
} from '@/infrastructure/clients/GmailClient/GmailClient.mock';
import { GmailInboxScope } from './GmailConnector.types';
import {
  backfillQuery,
  buildReply,
  encodeHeader,
  htmlToText,
  isWanted,
  messageToItem,
  parseAddresses,
  stripQuoted,
  toItemRaw,
} from './GmailConnector.utils';

describe('isWanted', () => {
  test('only inbox mail, never spam, trash or drafts', () => {
    expect(isWanted(['INBOX', 'UNREAD'], GmailInboxScope.AllInbox)).toBe(true);
    expect(isWanted(['UNREAD'], GmailInboxScope.AllInbox)).toBe(false);
    expect(isWanted(['INBOX', 'SPAM'], GmailInboxScope.AllInbox)).toBe(false);
  });

  test('tabs follow the scope', () => {
    const promo = ['INBOX', 'CATEGORY_PROMOTIONS'];
    const updates = ['INBOX', 'CATEGORY_UPDATES'];

    expect(isWanted(promo, GmailInboxScope.NoPromotions)).toBe(false);
    expect(isWanted(updates, GmailInboxScope.NoPromotions)).toBe(true);
    expect(isWanted(updates, GmailInboxScope.PrimaryOnly)).toBe(false);
    expect(isWanted(['INBOX'], GmailInboxScope.PrimaryOnly)).toBe(true);
    expect(backfillQuery(GmailInboxScope.NoPromotions, 7)).toBe(
      'in:inbox is:unread newer_than:7d -category:promotions'
    );
  });
});

describe('parsing', () => {
  test('addresses keep quoted commas together', () => {
    expect(parseAddresses('"Doe, Jane" <jane@x.io>, bob@y.io')).toEqual([
      { name: 'Doe, Jane', address: 'jane@x.io' },
      { name: '', address: 'bob@y.io' },
    ]);
  });

  test('quoted history is dropped in English and Czech', () => {
    expect(stripQuoted('Sure.\n\nOn Mon, 1 Sep 2026, Jana wrote:\n> hi')).toBe('Sure.');
    expect(stripQuoted('Ano.\nDne 27. 9. 2026 v 10:00 Jozef napsal(a):\n> x')).toBe('Ano.');
    expect(stripQuoted('a\n> quoted\nb')).toBe('a\nb');
  });

  test('HTML-only mail becomes readable text', () => {
    expect(htmlToText('<style>x{}</style><p>Hi&nbsp;there</p><p>Line&amp;2<br>3</p>')).toBe(
      'Hi there\nLine&2\n3'
    );
  });
});

describe('messageToItem', () => {
  test('a colleague’s reply becomes an email item with the new text only', () => {
    const item = messageToItem('conn', MOCK_GMAIL_MESSAGE, MOCK_MAILBOX, 4000);

    expect(item.kind).toBe(ItemKind.Email);
    expect(item.author).toBe('Jana Nováková');
    expect(item.title).toBe('Re: Čísla za září');
    expect(item.body).toBe('Can you send the numbers by Friday?');
    expect(item.threadKey).toBe('t1');
    expect(item.url).toBe('https://mail.google.com/mail/u/jozef%40example.com/#all/t1');
    expect(item.features).toMatchObject({
      fromDomain: 'example.com',
      toMe: true,
      isBulk: false,
      isReply: true,
      category: 'PRIMARY',
    });
  });
});

describe('buildReply', () => {
  test('threads the reply and encodes non-ASCII headers', () => {
    const mime = Buffer.from(
      buildReply(toItemRaw(MOCK_GMAIL_MESSAGE, MOCK_MAILBOX), 'Pošlu v pátek.'),
      'base64url'
    ).toString('utf8');
    const [head = '', body = ''] = mime.split('\r\n\r\n');

    expect(head).toContain(`To: ${encodeHeader('Jana Nováková')} <jana@example.com>`);
    expect(head).toContain(`Subject: ${encodeHeader('Re: Čísla za září')}`);
    expect(head).toContain('In-Reply-To: <abc@mail.example.com>');
    expect(head).toContain('References: <first@mail.example.com> <abc@mail.example.com>');
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(
      'Pošlu v pátek.'
    );
  });

  test('prefers Reply-To and does not stack Re:', () => {
    const raw = {
      ...toItemRaw(MOCK_GMAIL_MESSAGE, MOCK_MAILBOX),
      subject: 'RE: plain',
      replyTo: [{ name: '', address: 'team@example.com' }],
    };
    const head = Buffer.from(buildReply(raw, 'ok'), 'base64url').toString('utf8');

    expect(head).toContain('To: team@example.com');
    expect(head).toContain('Subject: RE: plain\r\n');
  });
});
