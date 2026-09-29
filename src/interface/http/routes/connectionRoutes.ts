import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { parseBody } from '@/interface/http/validation.utils';
import { RuleOrigin } from '@/core/triage/Rule.types';
import {
  createConnectionBodySchema,
  ruleDraftBodySchema,
  setEnabledBodySchema,
  signInBodySchema,
  updateConnectionBodySchema,
  updateSecretsBodySchema,
} from '@/interface/http/schemas';

export const createConnectionRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/kinds', (c) => c.json({ kinds: container.connectionService.describeConnectors() }));

  app.get('/', async (c) => c.json({ connections: await container.connectionService.list() }));

  // Linking a phone (Signal): start returns the code to show as a QR; poll the status.
  app.post('/pairings', async (c) => {
    const target = parseBody(signInBodySchema, await c.req.json());

    return c.json(await container.connectionService.beginPairing(target));
  });

  app.get('/pairings/:id', (c) =>
    c.json(container.connectionService.pairingStatus(c.req.param('id')))
  );

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
      body.config,
      body.groupName
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

  app.get('/:id/rules', async (c) => {
    const id = c.req.param('id');
    const [rules, history] = await Promise.all([
      container.ruleService.list(id),
      container.ruleService.history(id),
    ]);

    return c.json({ rules, history });
  });

  app.post('/:id/rules', async (c) => {
    const draft = parseBody(ruleDraftBodySchema, await c.req.json());
    const rule = await container.ruleService.create(c.req.param('id'), draft, {
      origin: RuleOrigin.User,
    });

    return c.json({ rule }, 201);
  });

  app.post('/:id/rules/dry-run', async (c) => {
    const draft = container.ruleService.validate(
      parseBody(ruleDraftBodySchema, await c.req.json())
    );

    return c.json(await container.triageService.dryRun(c.req.param('id'), draft));
  });

  app.post('/:id/triage', async (c) =>
    c.json(await container.triageService.retriage(c.req.param('id')))
  );

  app.get('/:id/fields', async (c) =>
    c.json({ fields: await container.ruleService.fields(c.req.param('id')) })
  );

  app.delete('/:id', async (c) => {
    await container.connectionService.remove(c.req.param('id'));

    return c.json({ ok: true });
  });

  return app;
};
