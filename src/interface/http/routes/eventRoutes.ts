import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Container } from '@/dependency/container/container.types';

const KEEPALIVE_MS = 25_000;

/** One SSE stream per open dashboard tab, fed straight from the event bus. */
export const createEventRoutes = (container: Container) => {
  const app = new Hono();

  app.get('/', (c) =>
    streamSSE(c, async (stream) => {
      let counter = 0;
      let closed = false;
      const unsubscribe = container.eventBus.subscribe((event) => {
        void stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: String(++counter),
        });
      });
      // Cloudflare and some proxies drop idle streams; a comment line keeps them open.
      const keepalive = setInterval(
        () => void stream.writeSSE({ data: '', event: 'ping' }),
        KEEPALIVE_MS
      );

      stream.onAbort(() => {
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
      });

      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ at: new Date().toISOString() }),
      });

      while (!closed) {
        await stream.sleep(1_000);
      }
    })
  );

  return app;
};
