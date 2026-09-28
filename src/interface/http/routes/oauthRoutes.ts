import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { toError } from '@/core/errors/errors';

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char
  );

/**
 * Where a provider redirects the browser after sign-in (Google "Web" clients). The
 * `state` in the query ties it to the connection; success lands back on the list.
 */
export const createOAuthRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/callback', async (c) => {
    try {
      await container.connectionService.completeSignIn(c.req.url);

      return c.redirect('/#connections');
    } catch (error) {
      return c.html(
        `<!doctype html><meta name="viewport" content="width=device-width"><title>Sign-in failed</title>` +
          `<p>Sign-in failed: ${escapeHtml(toError(error).message)}</p><p><a href="/#connections">Back to Huginn</a></p>`,
        400
      );
    }
  });

  return app;
};
