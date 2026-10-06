import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { parseBody } from '@/interface/http/validation.utils';
import { groupBodySchema } from '@/interface/http/schemas';

/** Categories ("Work", "Personal") connections are shown under. */
export const createGroupRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/', async (c) => c.json({ groups: await container.connectionGroupService.list() }));

  // Returns the existing category when the name is taken (ignoring case).
  app.post('/', async (c) => {
    const { name } = parseBody(groupBodySchema, await c.req.json());

    return c.json({ group: await container.connectionGroupService.create(name) }, 201);
  });

  app.put('/:id', async (c) => {
    const { name } = parseBody(groupBodySchema, await c.req.json());

    return c.json({
      group: await container.connectionGroupService.rename(c.req.param('id'), name),
    });
  });

  app.delete('/:id', async (c) => {
    await container.connectionGroupService.remove(c.req.param('id'));

    return c.json({ ok: true });
  });

  return app;
};
