import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';

/** The Mac app itself: the update it has installed, and the restart that brings it in. */
export const createAppRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/update', (c) => c.json({ update: container.appUpdateService.waiting() }));

  app.post('/update/restart', (c) => {
    container.appUpdateService.restart();

    return c.json({ ok: true }, 202);
  });

  return app;
};
