import { Hono } from 'hono';
import type { Container } from '@/dependency/container/container.types';
import { parseBody } from '@/interface/http/validation.utils';
import { pushDeviceBodySchema, pushEndpointBodySchema } from '@/interface/http/schemas';

/** Devices that get Important items as notifications. */
export const createPushRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/', async (c) =>
    c.json({
      publicKey: container.pushService.publicKey(),
      devices: await container.pushService.devices(),
    })
  );

  app.post('/devices', async (c) => {
    const body = parseBody(pushDeviceBodySchema, await c.req.json());

    return c.json({
      device: await container.pushService.register({
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        label: body.label,
      }),
    });
  });

  app.post('/devices/remove', async (c) => {
    const { endpoint } = parseBody(pushEndpointBodySchema, await c.req.json());

    await container.pushService.unregister(endpoint);

    return c.json({ ok: true });
  });

  app.post('/test', async (c) => {
    const { endpoint } = parseBody(pushEndpointBodySchema, await c.req.json());

    return c.json({ delivered: await container.pushService.test(endpoint) });
  });

  return app;
};
