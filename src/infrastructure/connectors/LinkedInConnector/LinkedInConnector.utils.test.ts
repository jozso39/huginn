import { describe, expect, test } from 'bun:test';
import type { GmailMessage } from '@/core/clients/GmailClient/GmailClient.types';
import { ItemKind } from '@/core/items/Item.types';
import {
  MOCK_GMAIL_MESSAGE,
  MOCK_LINKEDIN_MESSAGE,
  MOCK_MAILBOX,
} from '@/infrastructure/clients/GmailClient/GmailClient.mock';
import { LinkedInNotice } from './LinkedInConnector.types';
import {
  classifyNotice,
  deepLink,
  linkedInMailSource,
  linkedInMailToItem,
  messageText,
  noticeText,
  personOf,
} from './LinkedInConnector.utils';

const withLabels = (message: GmailMessage, labelIds: string[]): GmailMessage => ({
  ...message,
  labelIds,
});

describe('LinkedIn notification mails', () => {
  test('a message mail becomes a direct message from the person, linking the conversation', () => {
    const item = linkedInMailToItem('c', MOCK_LINKEDIN_MESSAGE, MOCK_MAILBOX, 4000);

    expect(item.kind).toBe(ItemKind.DirectMessage);
    expect(item.author).toBe('Petra Dubovská');
    // The conversation, not the navigation bar; no /comm/, no tracking or tokens.
    expect(item.url).toBe('https://www.linkedin.com/messaging/thread/2-ABC=/');
    expect(item.threadKey).toBe('messaging:2-ABC=');
    expect(item.body).toBe(
      'Petra Dubovská\nHi Jozef, are you open to a chat about a role?\n\nReply'
    );
    expect(item.features).toMatchObject({ notice: LinkedInNotice.Message, isMessage: true });
  });

  test('the template header decides; sender and subject are the fallback', () => {
    expect(classifyNotice('email_career_insights_01', 'Petra and Denis shared jobs', '')).toBe(
      LinkedInNotice.Job
    );
    expect(classifyNotice('security_two_step_verification_login_attempt', 'x', '')).toBe(
      LinkedInNotice.Security
    );
    expect(classifyNotice('email_next_best_action_digest_01', 'View a post', '')).toBe(
      LinkedInNotice.Update
    );
    expect(classifyNotice('', 'Jana wants to connect', 'invitations@linkedin.com')).toBe(
      LinkedInNotice.Invitation
    );
    expect(
      classifyNotice('', 'Jana mentioned you in a comment', 'notifications@linkedin.com')
    ).toBe(LinkedInNotice.Mention);
    expect(classifyNotice('', '1 new Automation Engineer openings', 'messages-noreply@x')).toBe(
      LinkedInNotice.Job
    );
  });

  test('links fall back to the section when the mail has none for the item', () => {
    expect(
      deepLink(LinkedInNotice.Invitation, '<a href="https://www.linkedin.com/comm/feed/">')
    ).toBe('https://www.linkedin.com/mynetwork/invitation-manager/');
    expect(personOf('LinkedIn', 'Jana Nováková wants to connect')).toBe('Jana Nováková');
    expect(personOf('LinkedIn', '1 new job for you')).toBe('LinkedIn');
    expect(noticeText('Line one\nUnsubscribe\nfooter')).toBe('Line one');
  });

  test('only unread LinkedIn mail in the inbox is taken, whatever tab it is in', () => {
    const source = linkedInMailSource();

    expect(source.accepts(MOCK_LINKEDIN_MESSAGE)).toBe(true);
    expect(source.accepts(withLabels(MOCK_LINKEDIN_MESSAGE, ['INBOX']))).toBe(false);
    expect(source.accepts(withLabels(MOCK_LINKEDIN_MESSAGE, ['INBOX', 'UNREAD', 'SPAM']))).toBe(
      false
    );
    expect(source.accepts(MOCK_GMAIL_MESSAGE)).toBe(false);
    expect(source.backfillQuery(7)).toBe('in:inbox is:unread newer_than:7d from:linkedin.com');
  });
});

// The layouts of LinkedIn's real message mails (text/plain), with made-up people and words.
const FOOTER = [
  '    ',
  '----------------------------------------',
  '',
  'This email was intended for Jozef Čambora (Engineer)',
  'Learn why we included this: https://www.linkedin.com/help/linkedin/answer/4788?lang=en&lipi=urn',
  'Unsubscribe: https://www.linkedin.com/comm/mypreferences/u/emailunsub?action=update&lipi=urn',
];
const INMAIL_REPLY = [
  'Message replied: AI Engineer | Prague',
  'InMail: You have a new message',
  '',
  '        Jana Nováková🌼',
  '',
  '      Reply',
  '      https://www.linkedin.com/comm/messaging/thread/2-XYZ?lipi=urn%3Ali%3Apage%3Aemail_hire_inmail',
  '',
  'Dobrý den, Jozefe,',
  '',
  'měl byste čas na krátký hovor?',
  ...FOOTER,
].join('\n');
const MEMBER_DIGEST = [
  'You have 2 new messages',
  '',
  '.....................................',
  '',
  'Petr Novák (We work with IT consultants around the world)',
  '(https://cz.linkedin.com/in/petrnovak-example-profile-link)',
  '',
  'View messages: https://www.linkedin.com/comm/messaging/thread/2-ABC?lipi=urn%3Ali%3Apage%3Aemail_member',
  '',
  '.....................................',
  '}',
  ...FOOTER,
].join('\n');

const mailWith = (subject: string, template: string, text: string): GmailMessage => ({
  ...MOCK_LINKEDIN_MESSAGE,
  payload: {
    ...MOCK_LINKEDIN_MESSAGE.payload,
    headers: (MOCK_LINKEDIN_MESSAGE.payload.headers ?? []).map((h) =>
      h.name === 'Subject'
        ? { ...h, value: subject }
        : h.name === 'X-LinkedIn-Template'
          ? { ...h, value: template }
          : h
    ),
    parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } }],
  },
});

describe('what people wrote, out of LinkedIn message mails', () => {
  test('an InMail: only the text below its Reply button, and an answer titled Re:', () => {
    const item = linkedInMailToItem(
      'c',
      mailWith(
        'Message replied: AI Engineer | Prague',
        'email_hire_inmail_reply_to_member_01',
        INMAIL_REPLY
      ),
      MOCK_MAILBOX,
      4000
    );

    expect(item.kind).toBe(ItemKind.DirectMessage);
    expect(item.title).toBe('Re: AI Engineer | Prague');
    expect(item.body).toBe('Dobrý den, Jozefe,\n\nměl byste čas na krátký hovor?');
  });

  test('"just messaged you": LinkedIn sends no text, so who wrote and how many wait', () => {
    const item = linkedInMailToItem(
      'c',
      mailWith('Petr just messaged you', 'email_member_message_v2', MEMBER_DIGEST),
      MOCK_MAILBOX,
      4000
    );

    expect(item.title).toBe('Petr just messaged you');
    expect(item.body).toBe(
      'Petr Novák (We work with IT consultants around the world)\n' +
        '2 new messages. LinkedIn does not put the text in its e-mails: open it on LinkedIn.'
    );
  });

  test('a mail in another layout keeps its text', () => {
    expect(messageText('Hi Jozef, a quick question.')).toBe('Hi Jozef, a quick question.');
  });
});
