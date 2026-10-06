import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import type { Container } from '@/dependency/container/container.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import { localAccess } from './localAccess';
import { createConnectionRoutes } from './routes/connectionRoutes';
import { createEventRoutes } from './routes/eventRoutes';
import { createGroupRoutes } from './routes/groupRoutes';
import { createItemRoutes } from './routes/itemRoutes';
import { createOAuthRoutes } from './routes/oauthRoutes';
import { createPushRoutes } from './routes/pushRoutes';
import { createRuleRoutes } from './routes/ruleRoutes';
import { createSettingsRoutes } from './routes/settingsRoutes';

const STATUS_BY_CODE: Record<ErrorCode, 400 | 401 | 404 | 422 | 502> = {
  [ErrorCode.Validation]: 400,
  [ErrorCode.Unauthorized]: 401,
  [ErrorCode.NotFound]: 404,
  [ErrorCode.Unsupported]: 422,
  [ErrorCode.Upstream]: 502,
};

export const createApp = (container: Container, webRoot: string, port: () => number) => {
  const app = new Hono();
  const { launchToken } = container.config.desktop;

  // The Mac app's window is the only client; see localAccess for why.
  if (launchToken) {
    app.use('*', localAccess(launchToken, port));
  }

  app.route('/api/items', createItemRoutes(container));
  app.route('/api/connections', createConnectionRoutes(container));
  app.route('/api/groups', createGroupRoutes(container));
  app.route('/api/settings', createSettingsRoutes(container));
  app.route('/api/events', createEventRoutes(container));
  app.route('/api/oauth', createOAuthRoutes(container));
  app.route('/api/rules', createRuleRoutes(container));
  app.route('/api/push', createPushRoutes(container));
  app.get('/api/health', (c) => c.json({ ok: true }));

  app.onError((error, c) => {
    if (error instanceof HuginnError) {
      return c.json(
        { error: error.code, message: error.message, details: error.details ?? null },
        STATUS_BY_CODE[error.code]
      );
    }

    container.logger.error({ err: toError(error), path: c.req.path }, 'unhandled error');

    return c.json({ error: 'Internal', message: 'internal error' }, 500);
  });

  // Vite fingerprints everything under /assets, so it can be cached forever. The rest —
  // index.html above all — must be revalidated, or a phone keeps the old app after a deploy.
  app.use('/*', async (c, next) => {
    await next();

    if (!c.req.path.startsWith('/api/') && c.res.ok) {
      c.header(
        'Cache-Control',
        c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
      );
    }
  });

  // The SPA: real files first, then index.html for client-side routes.
  app.use('/*', serveStatic({ root: webRoot }));
  app.get('/*', serveStatic({ root: webRoot, path: 'index.html' }));

  return app;
};
