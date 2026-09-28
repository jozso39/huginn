import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { ErrorCode, HuginnError } from '@/core/errors/errors';
import { parseBody, parseQuery } from '@/interface/http/validation.utils';
import {
  ingestBodySchema,
  listItemsQuerySchema,
  reactBodySchema,
  replyBodySchema,
} from '@/interface/http/schemas';

export const createItemRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/', async (c) => {
    const filter = parseQuery(listItemsQuerySchema, c.req.query());

    return c.json({ items: await container.inboxService.list(filter) });
  });

  app.get('/:id', async (c) => {
    const found = await container.inboxService.get(c.req.param('id'));

    if (!found) {
      throw new HuginnError(ErrorCode.NotFound, 'item not found');
    }

    return c.json(found);
  });

  app.post('/:id/reply', async (c) => {
    const { text } = parseBody(replyBodySchema, await c.req.json());

    return c.json({ item: await container.inboxService.reply(c.req.param('id'), text) });
  });

  app.post('/:id/draft', async (c) => {
    const { text } = parseBody(replyBodySchema, await c.req.json());

    return c.json({ item: await container.inboxService.draft(c.req.param('id'), text) });
  });

  app.post('/:id/react', async (c) => {
    const { emoji } = parseBody(reactBodySchema, await c.req.json());

    return c.json({ item: await container.inboxService.react(c.req.param('id'), emoji) });
  });

  app.post('/:id/done', async (c) =>
    c.json({ item: await container.inboxService.done(c.req.param('id')) })
  );

  app.post('/:id/reopen', async (c) =>
    c.json({ item: await container.inboxService.reopen(c.req.param('id')) })
  );

  // External writers. Authenticated by the ingest key, not by being on the tailnet,
  // so a Hermes skill running as another user can still post.
  app.post('/', async (c) => {
    if (c.req.header('x-huginn-key') !== container.config.ingestKey) {
      throw new HuginnError(ErrorCode.Unauthorized, 'bad ingest key');
    }

    const body = parseBody(ingestBodySchema, await c.req.json());
    const connectionId = body.connectionId ?? (await resolveIngestConnection(container));
    const item = await container.inboxService.ingest({
      connectionId,
      externalId: body.externalId,
      threadKey: body.threadKey ?? body.externalId,
      kind: body.kind,
      author: body.author,
      title: body.title,
      body: body.body.slice(0, container.config.maxBodyChars),
      url: body.url,
      receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
      features: body.features,
      raw: body,
    });

    return c.json({ item }, 201);
  });

  return app;
};

/** The first Ingest connection, created on demand so a script needs no setup. */
const resolveIngestConnection = async (container: Container): Promise<string> => {
  const existing = (await container.connectionService.list()).find(
    (connection) => connection.kind === ConnectorKind.Ingest
  );

  if (existing) {
    return existing.id;
  }

  const created = await container.connectionService.create({
    kind: ConnectorKind.Ingest,
    name: 'Ingest',
    config: {},
    secrets: {},
  });

  return created.id;
};
