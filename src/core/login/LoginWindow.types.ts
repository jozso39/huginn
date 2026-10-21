/**
 * A service's own sign-in page in a window of the Mac app, for services with no API
 * sign-in (Messenger). The user signs in there; Huginn gets the session's cookies and
 * never the password.
 */
export interface LoginWindowRequest {
  /** The window's title; the page's host is shown after it. */
  readonly title: string;
  readonly url: string;
  /** The browser the window poses as: the same one the connection uses afterwards. */
  readonly userAgent: string;
  /** The sites the window may show (a host and its subdomains); other links open in the browser. */
  readonly hosts: readonly string[];
  /** A pattern (regular expression) of the pages that mean the user is signed in. */
  readonly done: string;
  /** Whose cookies are taken: this domain and its subdomains. */
  readonly cookieDomain: string;
  /** Cookies that must be there; the window waits for them. */
  readonly required: readonly string[];
  /** Cookies taken too when present. No others leave the window. */
  readonly optional: readonly string[];
}

export type SessionCookies = Readonly<Record<string, string>>;

export interface ILoginWindow {
  /** Opens the window; resolves with the cookies once signed in, or null when it was closed first. */
  open(request: LoginWindowRequest): Promise<SessionCookies | null>;
}
