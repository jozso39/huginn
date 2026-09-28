import 'dotenv/config';
import { z } from 'zod';

// Fail at boot, not on the first request, when the environment is wrong.
const envSchema = z.object({
  HUGINN_SECRET_KEY: z.string().min(32, 'HUGINN_SECRET_KEY must be 32 random bytes, base64'),
  HUGINN_INGEST_KEY: z.string().min(16),
  HUGINN_DB_PATH: z.string().default('./data/huginn.db'),
  // Where the browser reaches Huginn, e.g. https://pi.tail3fa1f4.ts.net:8443. Only
  // needed for OAuth providers that redirect straight back (a Google "Web" client).
  HUGINN_PUBLIC_URL: z.url().optional(),
  // A static page on a domain Google already trusts that forwards sign-ins back to
  // HUGINN_PUBLIC_URL (see docs/oauth-relay.html). Optional.
  HUGINN_OAUTH_RELAY_URL: z.url().optional(),
  // Triage: Jev for soft rules and guardrails, a chat model for the rule agent.
  // Without a key Huginn still triages with hard rules only.
  HUGINN_OPENROUTER_API_KEY: z.string().min(10).optional(),
  HUGINN_JEV_MODEL: z.string().default('typesafe/jev-1.13'),
  HUGINN_FEEDBACK_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
  PORT: z.coerce.number().int().min(0).default(3000),
  LOG_LEVEL: z.enum(['silent', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export const getCleanEnv = (): Env => envSchema.parse(process.env);
