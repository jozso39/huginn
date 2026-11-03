import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { parseBody } from '@/interface/http/validation.utils';
import { automaticUpdatesBodySchema } from '@/interface/http/schemas';

/**
 * Huginn itself: its version and what is new in it, and the Mac app's updates. Checks
 * and installs answer at once; their outcome arrives on the event stream (AppChanged).
 */
export const createAppRoutes = (container: Container) => {
  const app = new Hono();
  const service = container.appUpdateService;

  app.get('/', (c) => c.json({ app: service.info() }));

  app.put('/updates', async (c) => {
    const { automatic } = parseBody(automaticUpdatesBodySchema, await c.req.json());

    return c.json({ app: await service.setAutomatic(automatic) });
  });

  app.post('/updates/check', (c) => {
    service.check();

    return c.json({ ok: true }, 202);
  });

  app.post('/updates/install', (c) => {
    service.install();

    return c.json({ ok: true }, 202);
  });

  app.post('/updates/restart', (c) => {
    service.restart();

    return c.json({ ok: true }, 202);
  });

  app.post('/whats-new/dismiss', async (c) => c.json({ app: await service.dismissWhatsNew() }));

  return app;
};
