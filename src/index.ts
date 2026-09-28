import { resolve } from 'node:path';
import { createContainer } from '@/dependency/container/container';
import { createApp } from '@/interface/http/app';

const main = async () => {
  const container = createContainer();
  const { logger, config } = container;

  await container.connectorHost.startAll();

  const app = createApp(container, resolve(import.meta.dir, '../web/dist'));
  const server = Bun.serve({
    port: config.port,
    hostname: '0.0.0.0',
    fetch: app.fetch,
    // SSE streams are long-lived; Bun's default would cut them at 10 s.
    idleTimeout: 0,
  });

  logger.info({ port: server.port }, 'huginn listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await container.connectorHost.stopAll();
    await server.stop();
    container.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

void main();
