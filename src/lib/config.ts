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
    vapid:
      env.HUGINN_VAPID_PUBLIC_KEY && env.HUGINN_VAPID_PRIVATE_KEY
        ? {
            publicKey: env.HUGINN_VAPID_PUBLIC_KEY,
            privateKey: env.HUGINN_VAPID_PRIVATE_KEY,
            subject: env.HUGINN_VAPID_SUBJECT,
          }
        : null,
    signalSocket: env.HUGINN_SIGNAL_SOCKET ?? null,
    ai: {
      openRouterApiKey: env.HUGINN_OPENROUTER_API_KEY ?? null,
      jevModel: env.HUGINN_JEV_MODEL,
      feedbackModel: env.HUGINN_FEEDBACK_MODEL,
      // Jev answers in ~0.5 s; past this, triage falls back to Undecided.
      jevTimeoutMs: 5_000,
      feedbackTimeoutMs: 45_000,
    },
    connectors: {
      // Polling connectors take their cadence from each connection's "Check every"
      // setting; tests set this to keep every interval from firing.
      pollOverrideMs: null as number | null,
      // Slack read markers, when a connection clears what was read there.
      slackReadCheckMs: 60_000,
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
