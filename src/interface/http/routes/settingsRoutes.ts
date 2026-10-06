import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { parseBody } from '@/interface/http/validation.utils';
import { settingsBodySchema } from '@/interface/http/schemas';

export const createSettingsRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/', async (c) => c.json({ settings: await container.settingsService.get() }));

  app.put('/', async (c) => {
    const patch = parseBody(settingsBodySchema, await c.req.json());

    return c.json({ settings: await container.settingsService.update(patch) });
  });

  return app;
};
