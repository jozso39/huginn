import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import type { Container } from '@/dependency/container/container.types';
import { ErrorCode, HuginnError, toError } from '@/core/errors/errors';
import { createConnectionRoutes } from './routes/connectionRoutes';
import { createEventRoutes } from './routes/eventRoutes';
import { createItemRoutes } from './routes/itemRoutes';

const STATUS_BY_CODE: Record<ErrorCode, 400 | 401 | 404 | 422 | 502> = {
  [ErrorCode.Validation]: 400,
  [ErrorCode.Unauthorized]: 401,
  [ErrorCode.NotFound]: 404,
  [ErrorCode.Unsupported]: 422,
  [ErrorCode.Upstream]: 502,
};

export const createApp = (container: Container, webRoot: string) => {
  const app = new Hono();

  app.route('/api/items', createItemRoutes(container));
  app.route('/api/connections', createConnectionRoutes(container));
  app.route('/api/events', createEventRoutes(container));
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

  // The SPA: real files first, then index.html for client-side routes.
  app.use('/*', serveStatic({ root: webRoot }));
  app.get('/*', serveStatic({ root: webRoot, path: 'index.html' }));

  return app;
};
