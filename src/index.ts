import { createConfig } from '@/lib/config';
import { createContainer } from '@/dependency/container/container';
import { DesktopChannel } from '@/infrastructure/desktop/DesktopChannel';
import { createApp } from '@/interface/http/app';

// The Mac app's port first; the next two are registered as Slack sign-in fallbacks.
const PORT_TRIES = 3;

const main = async () => {
  const desktop = process.env.HUGINN_DESKTOP === '1' ? new DesktopChannel() : null;

  // In the Mac app secrets come over stdin, so they never show in the process list or
  // environment; otherwise from the environment (.env).
  const secrets = desktop ? await desktop.readSecrets() : {};
  const container = createContainer({
    config: createConfig(secrets),
    ...(desktop ? { attentionSink: desktop } : {}),
  });
  const { logger, config } = container;

  // Connections from before triage existed get their connector's default rules.
  await container.ruleService.installMissingDefaults();
  // Before the connectors, so nothing Important slips past the phone or the menu bar.
  container.pushService.start();
  await container.attentionService.start();
  await container.connectorHost.startAll();

  let port = config.port;
  const app = createApp(container, config.paths.web, () => port);
  const serve = (attempt: number): ReturnType<typeof Bun.serve> => {
    try {
      return Bun.serve({
        port: config.port + attempt,
        hostname: config.host,
        fetch: app.fetch,
        // SSE streams are long-lived; Bun's default would cut them at 10 s.
        idleTimeout: 0,
      });
    } catch (error) {
      if (desktop && attempt + 1 < PORT_TRIES) {
        return serve(attempt + 1);
      }

      throw error;
    }
  };

  const server = serve(0);

  port = server.port ?? config.port;
  logger.info({ host: config.host, port }, 'huginn listening');
  desktop?.ready(port);

  const shutdown = async (reason: string) => {
    logger.info({ reason }, 'shutting down');
    container.attentionService.stop();
    container.pushService.stop();
    await container.connectorHost.stopAll();
    // Close open connections too (the window's live stream): a plain stop waits for them.
    await server.stop(true);
    container.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  if (desktop) {
    // The app quit or crashed: never keep running with access to every account.
    void desktop.closed().then(() => shutdown('shell gone'));
  }
};

void main();
