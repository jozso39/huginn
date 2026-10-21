import type {
  IMessengerClient,
  IMessengerSession,
  MessengerAccount,
  MessengerEvent,
  MessengerEventHandler,
} from '@/core/clients/MessengerClient/MessengerClient.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import type { SessionCookies } from '@/core/login/LoginWindow.types';

export const MOCK_MESSENGER_ACCOUNT: MessengerAccount = { userId: '100000001', name: 'Jana' };

export class MockMessengerSession implements IMessengerSession {
  public handler: MessengerEventHandler | null = null;
  public stopped = false;

  constructor(
    public readonly cookies: SessionCookies,
    private readonly unauthorized: boolean
  ) {}

  public start(handler: MessengerEventHandler): Promise<MessengerAccount> {
    if (this.unauthorized) {
      return Promise.reject(
        new HuginnError(ErrorCode.Unauthorized, 'Facebook ended the session — log in again')
      );
    }

    this.handler = handler;
    this.stopped = false;

    return Promise.resolve(MOCK_MESSENGER_ACCOUNT);
  }

  public stop(): Promise<void> {
    this.stopped = true;
    this.handler = null;

    return Promise.resolve();
  }

  /** What the helper would push. */
  public emit(event: MessengerEvent): void {
    this.handler?.(event);
  }
}

export class MockMessengerClient implements IMessengerClient {
  public readonly sessions: MockMessengerSession[] = [];
  public readonly logins: SessionCookies[] = [];
  public available = true;
  /** New sessions fail as if Facebook had ended them. */
  public unauthorized = false;

  public isAvailable(): boolean {
    return this.available;
  }

  public userAgent(): Promise<string> {
    return Promise.resolve('Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0 Safari/537.36');
  }

  public login(
    cookies: SessionCookies
  ): Promise<MessengerAccount & { readonly cookies: SessionCookies }> {
    this.logins.push(cookies);

    return Promise.resolve({ ...MOCK_MESSENGER_ACCOUNT, cookies });
  }

  public session(cookies: SessionCookies): MockMessengerSession {
    const session = new MockMessengerSession(cookies, this.unauthorized);

    this.sessions.push(session);

    return session;
  }

  public close(): Promise<void> {
    return Promise.all(this.sessions.map((session) => session.stop())).then(() => undefined);
  }
}
