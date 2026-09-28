import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { RuleOrigin } from '@/core/triage/Rule.types';
import { parseBody } from '@/interface/http/validation.utils';
import {
  ruleDraftBodySchema,
  ruleMoveBodySchema,
  ruleStatusBodySchema,
} from '@/interface/http/schemas';

/** One rule: edit, approve/disable, reorder, delete. Listing is per connection. */
export const createRuleRoutes = (container: Container) => {
  const app = new Hono();

  app.put('/:id', async (c) => {
    const draft = parseBody(ruleDraftBodySchema, await c.req.json());

    return c.json({
      rule: await container.ruleService.update(c.req.param('id'), draft, {
        origin: RuleOrigin.User,
      }),
    });
  });

  app.put('/:id/status', async (c) => {
    const { status } = parseBody(ruleStatusBodySchema, await c.req.json());

    return c.json({ rule: await container.ruleService.setStatus(c.req.param('id'), status) });
  });

  app.post('/:id/move', async (c) => {
    const { direction } = parseBody(ruleMoveBodySchema, await c.req.json());

    await container.ruleService.move(c.req.param('id'), direction);

    return c.json({ ok: true });
  });

  app.delete('/:id', async (c) => {
    await container.ruleService.remove(c.req.param('id'));

    return c.json({ ok: true });
  });

  return app;
};
