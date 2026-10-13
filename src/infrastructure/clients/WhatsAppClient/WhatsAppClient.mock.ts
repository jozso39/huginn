import type {
  IWhatsAppClient,
  IWhatsAppSession,
  WhatsAppEvent,
  WhatsAppEventHandler,
  WhatsAppLink,
  WhatsAppMessage,
  WhatsAppMessageRef,
} from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import { WhatsAppEventType } from '@/core/clients/WhatsAppClient/WhatsAppClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

export const MOCK_WHATSAPP_ACCOUNT = '+420600000001';
export const MOCK_WHATSAPP_CODE = 'https://wa.me/settings/linked_devices#test-1';
/** What WhatsApp replaces the first code with while the phone has not scanned it. */
export const MOCK_WHATSAPP_NEXT_CODE = 'https://wa.me/settings/linked_devices#test-2';
/** Keys that the phone has since unlinked. */
export const MOCK_WHATSAPP_UNLINKED = 'unlinked';

/** A friend's direct message. */
export const MOCK_WHATSAPP_DM: WhatsAppMessage = {
  id: '3EB0A1B2C3D4E5F6',
  chat: '420600000002@s.whatsapp.net',
  isGroup: false,
  groupName: null,
  sender: '420600000002@s.whatsapp.net',
  senderName: 'Petra',
  senderPhone: '+420600000002',
  text: 'Are we still on for Friday?',
  hasMedia: false,
  mentionsMe: false,
  repliesToMe: false,
  sentAt: new Date('2026-10-13T08:00:00.000Z'),
};

/** A message in a group that does not concern the account. */
export const MOCK_WHATSAPP_GROUP: WhatsAppMessage = {
  id: '3EB0FFEEDDCCBBAA',
  chat: '120363000000000001@g.us',
  isGroup: true,
  groupName: 'Family',
  sender: '420600000003@s.whatsapp.net',
  senderName: 'Tomáš',
  senderPhone: '+420600000003',
  text: '[photo] Look at this',
  hasMedia: true,
  mentionsMe: false,
  repliesToMe: false,
  sentAt: new Date('2026-10-13T08:05:00.000Z'),
};

class MockWhatsAppSession implements IWhatsAppSession {
  public handler: WhatsAppEventHandler | null = null;

  constructor(
    private readonly client: MockWhatsAppClient,
    public readonly auth: string
  ) {}

  public start(handler: WhatsAppEventHandler): Promise<void> {
    if (this.auth === MOCK_WHATSAPP_UNLINKED) {
      return Promise.reject(new HuginnError(ErrorCode.Unauthorized, 'Unlinked on the phone'));
    }

    this.handler = handler;
    handler({ type: WhatsAppEventType.Connected });

    return Promise.resolve();
  }

  public stop(): Promise<void> {
    this.handler = null;

    return Promise.resolve();
  }

  public send(
    to: string,
    text: string,
    quote?: WhatsAppMessageRef
  ): Promise<{ readonly id: string }> {
    this.client.sent = [...this.client.sent, { to, text, quote: quote?.id ?? null }];

    return Promise.resolve({ id: 'SENT1' });
  }

  public react(target: WhatsAppMessageRef, emoji: string): Promise<void> {
    this.client.reactions = [...this.client.reactions, { id: target.id, emoji }];

    return Promise.resolve();
  }

  public markRead(target: WhatsAppMessageRef): Promise<void> {
    this.client.reads = [...this.client.reads, target.id];

    return Promise.resolve();
  }
}

/** Linking succeeds with MOCK_WHATSAPP_ACCOUNT; `deliver` plays WhatsApp pushing events. */
export class MockWhatsAppClient implements IWhatsAppClient {
  public sent: readonly { to: string; text: string; quote: string | null }[] = [];
  public reactions: readonly { id: string; emoji: string }[] = [];
  public reads: readonly string[] = [];
  public phoneCodes: readonly string[] = [];
  private sessions: readonly MockWhatsAppSession[] = [];

  public session(auth: string): IWhatsAppSession {
    const session = new MockWhatsAppSession(this, auth);

    this.sessions = [...this.sessions, session];

    return session;
  }

  public startLink(): Promise<string> {
    return Promise.resolve(MOCK_WHATSAPP_CODE);
  }

  public currentLinkCode(code: string): string | null {
    return code === MOCK_WHATSAPP_CODE ? MOCK_WHATSAPP_NEXT_CODE : null;
  }

  public linkWithPhone(_code: string, phoneNumber: string): Promise<string> {
    this.phoneCodes = [...this.phoneCodes, phoneNumber];

    return Promise.resolve('ABCD-EFGH');
  }

  public finishLink(): Promise<WhatsAppLink> {
    return Promise.resolve({ account: MOCK_WHATSAPP_ACCOUNT, name: 'Jozef', auth: 'auth-1' });
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  /** The newest running session gets the event, as the one connection would. */
  public deliver(event: WhatsAppEvent): void {
    [...this.sessions]
      .reverse()
      .find((session) => session.handler)
      ?.handler?.(event);
  }

  /** The keys the running connection stored last. */
  public get running(): MockWhatsAppSession | undefined {
    return [...this.sessions].reverse().find((session) => session.handler);
  }
}
