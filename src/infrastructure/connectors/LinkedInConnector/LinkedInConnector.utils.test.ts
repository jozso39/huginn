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
