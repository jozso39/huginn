import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

const SESSION_COOKIE = 'huginn_session';

/** Constant-time string comparison for secrets. */
export const sameSecret = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
};

/** `127.0.0.1:47823` and `localhost:47823`, the only names this server answers to. */
export const allowedHosts = (port: number): ReadonlySet<string> =>
  new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

/** Paths a request without the session may reach. */
const isOpen = (path: string): boolean =>
  path === '/api/health' ||
  // The provider's redirect after sign-in; protected by its one-time `state`.
  path === '/api/oauth/callback' ||
  // The web app's files hold no data; the API behind them does.
  !path.startsWith('/api/');

/**
 * The Mac app's guard. On a laptop any web page in any browser can send requests to
 * 127.0.0.1, so the API answers only:
 * - under its own host names (a DNS-rebinding page has a foreign Host header),
 * - to the app's window, which proves itself once with the launch token from the shell
 *   (`/__launch?token=…`) and from then on carries a SameSite=Strict, HttpOnly cookie,
 * - for writes, from its own origin.
 */
export const localAccess =
  (launchToken: string, port: () => number): MiddlewareHandler =>
  async (c, next) => {
    const hosts = allowedHosts(port());

    if (!hosts.has(c.req.header('host') ?? '')) {
      return c.text('unknown host', 403);
    }

    const origin = c.req.header('origin');

    if (c.req.method !== 'GET' && origin && !hosts.has(origin.replace(/^http:\/\//, ''))) {
      return c.text('foreign origin', 403);
    }

    if (c.req.path === '/__launch') {
      if (!sameSecret(c.req.query('token') ?? '', launchToken)) {
        return c.text('bad launch token', 403);
      }

      setCookie(c, SESSION_COOKIE, launchToken, {
        httpOnly: true,
        sameSite: 'Strict',
        path: '/',
      });

      return c.redirect('/');
    }

    if (isOpen(c.req.path) || sameSecret(getCookie(c, SESSION_COOKIE) ?? '', launchToken)) {
      await next();

      return undefined;
    }

    return c.json({ error: 'Unauthorized', message: 'open Huginn from its app' }, 401);
  };
