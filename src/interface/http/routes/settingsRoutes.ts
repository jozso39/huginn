import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { parseBody } from '@/interface/http/validation.utils';
import { aiKeyBodySchema, settingsBodySchema } from '@/interface/http/schemas';

export const createSettingsRoutes = (container: Container) => {
  const app = new Hono();

  // `ai` says which key is set (provider, last four characters), never the key.
  app.get('/', async (c) =>
    c.json({
      settings: await container.settingsService.get(),
      ai: container.settingsService.aiKey(),
    })
  );

  app.put('/', async (c) => {
    const patch = parseBody(settingsBodySchema, await c.req.json());

    return c.json({ settings: await container.settingsService.update(patch) });
  });

  app.put('/ai-key', async (c) => {
    const { provider, key } = parseBody(aiKeyBodySchema, await c.req.json());

    return c.json({ ai: await container.settingsService.setAiKey(provider, key) });
  });

  app.delete('/ai-key', async (c) => {
    await container.settingsService.removeAiKey();

    return c.json({ ok: true });
  });

  return app;
};
