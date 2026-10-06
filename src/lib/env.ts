import 'dotenv/config';
import { z } from 'zod';

// Fail at boot, not on the first request, when the environment is wrong.
const envSchema = z.object({
  // Seals every stored token. The Mac app hands it over on stdin instead.
  HUGINN_SECRET_KEY: z
    .string()
    .min(32, 'HUGINN_SECRET_KEY must be 32 random bytes, base64')
    .optional(),
  // Scripts may post items with this key (X-Huginn-Key). Without it ingest is off.
  HUGINN_INGEST_KEY: z.string().min(16).optional(),
  HUGINN_DB_PATH: z.string().default('./data/huginn.db'),
  // The Mac app: where its data lives (the database goes in here, overriding
  // HUGINN_DB_PATH) and where the bundled web app and migrations are.
  HUGINN_DATA_DIR: z.string().min(1).optional(),
  HUGINN_RESOURCES_DIR: z.string().min(1).optional(),
  // "1" when started by the Mac app: secrets arrive on stdin, events leave on stdout,
  // logs go to stderr, the API needs the launch token, stdin closing means quit.
  HUGINN_DESKTOP: z.enum(['0', '1']).default('0'),
  // Proof that a request comes from the app's own window (set from stdin in desktop mode).
  HUGINN_LAUNCH_TOKEN: z.string().min(32).optional(),
  // Loopback only by default: Huginn holds tokens to every account.
  HUGINN_HOST: z.string().default('127.0.0.1'),
  // Where the browser reaches Huginn, e.g. https://pi.tail3fa1f4.ts.net:8443. Only
  // needed for OAuth providers that redirect straight back (a Google "Web" client).
  HUGINN_PUBLIC_URL: z.url().optional(),
  // A static page on a domain Google already trusts that forwards sign-ins back to
  // HUGINN_PUBLIC_URL (see docs/oauth-relay.html). Optional.
  HUGINN_OAUTH_RELAY_URL: z.url().optional(),
  // Triage: Jev for sentence rules and guardrails, a chat model for the rule agent.
  // The key itself is set in Settings → AI Triage; these pin the models.
  HUGINN_JEV_MODEL: z.string().default('typesafe/jev-1.13'),
  HUGINN_TYPESAFE_JEV_MODEL: z.string().default('jev-1.13.0'),
  HUGINN_FEEDBACK_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
  // Signal: Huginn runs signal-cli itself (docs/signal.md), found on PATH or in
  // Homebrew's folders. Set this only for a signal-cli somewhere else.
  HUGINN_SIGNAL_CLI: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(0).default(3000),
  LOG_LEVEL: z.enum(['silent', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export const getCleanEnv = (): Env => envSchema.parse(process.env);
