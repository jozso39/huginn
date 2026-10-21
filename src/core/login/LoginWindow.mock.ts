import type { ILoginWindow, LoginWindowRequest, SessionCookies } from './LoginWindow.types';

/** The Mac app's login window, where the test plays the user: log in, or close it. */
export class MockLoginWindow implements ILoginWindow {
  public readonly requests: LoginWindowRequest[] = [];
  private answer: ((cookies: SessionCookies | null) => void) | null = null;

  public open(request: LoginWindowRequest): Promise<SessionCookies | null> {
    this.requests.push(request);

    return new Promise((resolve) => {
      this.answer = resolve;
    });
  }

  /** The user logged in: the window hands over these cookies. */
  public logIn(cookies: SessionCookies): void {
    this.answer?.(cookies);
    this.answer = null;
  }

  /** The user closed the window first. */
  public close(): void {
    this.answer?.(null);
    this.answer = null;
  }
}
