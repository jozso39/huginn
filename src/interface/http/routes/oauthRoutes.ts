import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { toError } from '@/core/errors/errors';
import { parseBody } from '@/interface/http/validation.utils';
import {
  oauthAppBodySchema,
  oauthProviderParamSchema,
  signInBodySchema,
} from '@/interface/http/schemas';

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char
  );

/**
 * Sign-in: the provider app set up once per provider, starting a sign-in, and the
 * callback the provider (or the relay page) sends the browser back to.
 */
export const createOAuthRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/apps/:provider', async (c) => {
    const provider = parseBody(oauthProviderParamSchema, c.req.param('provider'));

    return c.json({ app: await container.oauthAppService.view(provider) });
  });

  app.put('/apps/:provider', async (c) => {
    const provider = parseBody(oauthProviderParamSchema, c.req.param('provider'));
    const body = parseBody(oauthAppBodySchema, await c.req.json());

    return c.json({ app: await container.oauthAppService.save(provider, body) });
  });

  app.post('/sign-in', async (c) => {
    const target = parseBody(signInBodySchema, await c.req.json());

    return c.json(await container.connectionService.beginSignIn(target));
  });

  app.get('/callback', async (c) => {
    try {
      const connection = await container.connectionService.completeSignIn(c.req.url);

      // In the Mac app the sign-in ran in the user's browser, not in Huginn's window.
      if (container.config.desktop.enabled) {
        return c.html(
          '<!doctype html><meta name="viewport" content="width=device-width">' +
            '<title>Signed in</title>' +
            '<body style="font:16px -apple-system,sans-serif;padding:48px;text-align:center">' +
            `<p><strong>${escapeHtml(connection.name)}</strong> is connected to Huginn.</p>` +
            '<p>You can close this tab and go back to Huginn.</p>'
        );
      }

      return c.redirect('/#connections');
    } catch (error) {
      return c.html(
        '<!doctype html><meta name="viewport" content="width=device-width">' +
          '<title>Sign-in failed</title>' +
          `<p>Sign-in failed: ${escapeHtml(toError(error).message)}</p>` +
          '<p><a href="/#connections">Back to Huginn</a></p>',
        400
      );
    }
  });

  return app;
};
