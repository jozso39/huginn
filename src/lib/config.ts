import { dirname, join, resolve } from 'node:path';
import { getCleanEnv } from './env';

// From src/lib to the repository, for development runs; the Mac app passes its own paths.
const REPO_ROOT = resolve(import.meta.dir, '../..');

/** What the Mac app hands over on stdin rather than through the environment. */
export interface ConfigSecrets {
  readonly secretKey?: string;
  readonly launchToken?: string;
}

export const createConfig = (secrets: ConfigSecrets = {}) => {
  const env = getCleanEnv();
  const secretKey = secrets.secretKey ?? env.HUGINN_SECRET_KEY;

  if (!secretKey || secretKey.length < 32) {
    throw new Error('HUGINN_SECRET_KEY is missing: 32 random bytes, base64');
  }

  const dbPath = env.HUGINN_DATA_DIR ? join(env.HUGINN_DATA_DIR, 'huginn.db') : env.HUGINN_DB_PATH;

  return {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    host: env.HUGINN_HOST,
    dbPath,
    secretKey,
    ingestKey: env.HUGINN_INGEST_KEY ?? null,
    paths: {
      web: env.HUGINN_RESOURCES_DIR
        ? join(env.HUGINN_RESOURCES_DIR, 'web')
        : join(REPO_ROOT, 'web/dist'),
      migrations: env.HUGINN_RESOURCES_DIR
        ? join(env.HUGINN_RESOURCES_DIR, 'drizzle')
        : join(REPO_ROOT, 'drizzle'),
    },
    desktop: {
      enabled: env.HUGINN_DESKTOP === '1',
      launchToken: secrets.launchToken ?? env.HUGINN_LAUNCH_TOKEN ?? null,
    },
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
    signal: {
      // null: found on PATH or in Homebrew's folders when Signal is first used.
      cli: env.HUGINN_SIGNAL_CLI ?? null,
      // signal-cli's own data: the linked device's keys, kept with the database.
      dataDir: join(dirname(dbPath), 'signal'),
    },
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
