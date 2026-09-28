import { getCleanEnv } from './env';

export const createConfig = () => {
  const env = getCleanEnv();

  return {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    dbPath: env.HUGINN_DB_PATH,
    secretKey: env.HUGINN_SECRET_KEY,
    ingestKey: env.HUGINN_INGEST_KEY,
    publicUrl: env.HUGINN_PUBLIC_URL?.replace(/\/$/, '') ?? null,
    oauthRelayUrl: env.HUGINN_OAUTH_RELAY_URL ?? null,
    connectors: {
      // Polling cadence for connectors without a push channel. GitLab has no
      // documented per-token limit that a 60 s poll would approach.
      gitlabPollMs: 60_000,
      // Gmail allows 250 quota units per second per user; one history call a
      // minute is about 2 of them. A minute is plenty for mail.
      gmailPollMs: 60_000,
      // ClickUp: 100 requests/min per token; a minute's poll uses a handful.
      clickUpPollMs: 60_000,
      // A connector that crashes is restarted with this backoff so a dead
      // token does not hammer the provider.
      restartBackoffMs: [5_000, 30_000, 120_000, 600_000],
    },
    // Bodies are stored as plain text and capped: the dashboard shows a preview
    // and the deep link opens the original. Raw payloads keep the full thing.
    maxBodyChars: 4_000,
  };
};

export type IConfig = ReturnType<typeof createConfig>;
