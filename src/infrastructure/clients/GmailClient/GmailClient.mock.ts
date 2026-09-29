import type {
  GmailHistory,
  GmailMessage,
  GmailMessageRef,
  GmailProfile,
  IGmailClient,
} from '@/core/clients/GmailClient/GmailClient.types';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');

export const MOCK_MAILBOX = 'jozef@example.com';

/** A reply from a colleague, with the quoted history Gmail clients add underneath. */
export const MOCK_GMAIL_MESSAGE: GmailMessage = {
  id: 'm1',
  threadId: 't1',
  labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
  internalDate: '1759046400000',
  snippet: 'Can you send the numbers by Friday?',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'From', value: 'Jana Nováková <jana@example.com>' },
      { name: 'To', value: 'Jozef Čambora <jozef@example.com>' },
      { name: 'Subject', value: 'Re: Čísla za září' },
      { name: 'Message-ID', value: '<abc@mail.example.com>' },
      { name: 'References', value: '<first@mail.example.com>' },
      { name: 'In-Reply-To', value: '<first@mail.example.com>' },
    ],
    parts: [
      {
        mimeType: 'text/plain',
        body: {
          data: b64(
            'Can you send the numbers by Friday?\n\nDne 27. 9. 2026 v 10:00 Jozef napsal(a):\n> old text'
          ),
        },
      },
      { mimeType: 'text/html', body: { data: b64('<p>Can you send the numbers by Friday?</p>') } },
    ],
  },
};

/**
 * LinkedIn's mail about a new message: the navigation bar links come first, the
 * conversation link after them, every link wrapped in /comm/ and tracking parameters.
 */
export const MOCK_LINKEDIN_MESSAGE: GmailMessage = {
  id: 'li1',
  threadId: 'lt1',
  labelIds: ['INBOX', 'UNREAD', 'CATEGORY_SOCIAL'],
  internalDate: '1759046500000',
  snippet: 'Hi Jozef, are you open to a chat about a role?',
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      {
        name: 'From',
        value: 'Petra Dubovská via LinkedIn <messaging-digest-noreply@linkedin.com>',
      },
      { name: 'To', value: 'Jozef Čambora <jozef@example.com>' },
      { name: 'Subject', value: 'Petra Dubovská sent you a new message' },
      { name: 'X-LinkedIn-Template', value: 'email_messaging_single_01' },
      { name: 'List-Unsubscribe', value: '<https://www.linkedin.com/comm/psettings/unsub>' },
    ],
    parts: [
      {
        mimeType: 'text/plain',
        body: {
          data: b64(
            'Petra Dubovská\nHi Jozef, are you open to a chat about a role?\n\nReply\n\nThis email was intended for Jozef Čambora (Engineer)\nUnsubscribe'
          ),
        },
      },
      {
        mimeType: 'text/html',
        body: {
          data: b64(
            '<a href="https://www.linkedin.com/comm/feed/?lipi=urn">Home</a>' +
              '<a href="https://www.linkedin.com/comm/messaging/?lipi=urn">Messaging</a>' +
              '<a href="https://www.linkedin.com/comm/messaging/thread/2-ABC=/?midToken=secret&amp;trk=x">Reply</a>'
          ),
        },
      },
    ],
  },
};

/**
 * One unread message in the inbox and an empty history. Tests that need changes
 * set `nextHistory` before calling the connector's poll through the host.
 */
export class MockGmailClient implements IGmailClient {
  public nextHistory: GmailHistory | null = { records: [], historyId: '101' };
  public readonly messages = new Map<string, GmailMessage>([['m1', MOCK_GMAIL_MESSAGE]]);
  public readonly sent: { raw: string; threadId: string }[] = [];
  public readonly drafts: { raw: string; threadId: string }[] = [];
  public readonly markedRead: string[] = [];

  public profile(): Promise<GmailProfile> {
    return Promise.resolve({ emailAddress: MOCK_MAILBOX, historyId: '100' });
  }

  public searchMessageIds(_query: string, _max: number): Promise<readonly string[]> {
    return Promise.resolve(['m1']);
  }

  public getMessage(id: string): Promise<GmailMessage> {
    const message = this.messages.get(id);

    return message ? Promise.resolve(message) : Promise.reject(new Error(`no message ${id}`));
  }

  public history(_startHistoryId: string): Promise<GmailHistory | null> {
    return Promise.resolve(this.nextHistory);
  }

  public send(raw: string, threadId: string): Promise<GmailMessageRef> {
    this.sent.push({ raw, threadId });

    return Promise.resolve({ id: 'sent1', threadId });
  }

  public createDraft(raw: string, threadId: string): Promise<{ readonly id: string }> {
    this.drafts.push({ raw, threadId });

    return Promise.resolve({ id: 'draft1' });
  }

  public markRead(id: string): Promise<void> {
    this.markedRead.push(id);

    return Promise.resolve();
  }
}
