import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { parseBody } from '@/interface/http/validation.utils';
import {
  completeSignInBodySchema,
  createConnectionBodySchema,
  setEnabledBodySchema,
  updateConnectionBodySchema,
  updateSecretsBodySchema,
} from '@/interface/http/schemas';

export const createConnectionRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/kinds', (c) => c.json({ kinds: container.connectionService.describeConnectors() }));

  app.get('/', async (c) => c.json({ connections: await container.connectionService.list() }));

  app.get('/:id', async (c) => {
    const connection = await container.connectionService.get(c.req.param('id'));

    if (!connection) {
      throw new HuginnError(ErrorCode.NotFound, 'connection not found');
    }

    return c.json({ connection });
  });

  app.post('/', async (c) => {
    const body = parseBody(createConnectionBodySchema, await c.req.json());

    return c.json({ connection: await container.connectionService.create(body) }, 201);
  });

  app.put('/:id', async (c) => {
    const body = parseBody(updateConnectionBodySchema, await c.req.json());
    const connection = await container.connectionService.updateConfig(
      c.req.param('id'),
      body.name,
      body.config
    );

    return c.json({ connection });
  });

  app.put('/:id/secrets', async (c) => {
    const body = parseBody(updateSecretsBodySchema, await c.req.json());

    await container.connectionService.updateSecrets(c.req.param('id'), body.secrets);

    return c.json({ ok: true });
  });

  app.put('/:id/enabled', async (c) => {
    const body = parseBody(setEnabledBodySchema, await c.req.json());
    const connection = await container.connectionService.setEnabled(
      c.req.param('id'),
      body.enabled
    );

    return c.json({ connection });
  });

  app.post('/:id/sign-in', async (c) =>
    c.json(await container.connectionService.beginSignIn(c.req.param('id')))
  );

  // Paste-back: the address the provider left the user on, typed into the form.
  app.post('/sign-in/complete', async (c) => {
    const { redirectedTo } = parseBody(completeSignInBodySchema, await c.req.json());

    return c.json({ connection: await container.connectionService.completeSignIn(redirectedTo) });
  });

  app.delete('/:id', async (c) => {
    await container.connectionService.remove(c.req.param('id'));

    return c.json({ ok: true });
  });

  return app;
};
