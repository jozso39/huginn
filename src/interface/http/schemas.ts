import { z } from 'zod';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { OAuthProvider, RedirectMode } from '@/core/oauth/OAuthApp.types';
import { MoveDirection } from '@/core/services/RuleService/RuleService.types';
import { predicateSchema } from '@/core/triage/predicate.utils';
import { RuleKind, RuleStatus, RuleVerdict } from '@/core/triage/Rule.types';
import { Category, ItemState } from '@/core/items/Item.types';
import { AiProvider } from '@/core/settings/AiKey.types';
import { Theme } from '@/core/settings/Settings.types';

export const listItemsQuerySchema = z.object({
  state: z.enum(ItemState).optional(),
  category: z.enum(Category).optional(),
  connectionId: z.uuid().optional(),
  // The archive search: words that must all appear (case and accents ignored).
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const replyBodySchema = z.object({ text: z.string().trim().min(1).max(10_000) });

// An emoji ("👍") or a Slack short name ("thumbsup"); the connector checks it can send it.
export const reactBodySchema = z.object({ emoji: z.string().trim().min(1).max(64) });

// The category: a ConnectionGroup's id, null for none.
const groupIdSchema = z.uuid().nullable().optional();
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #3b82f6')
  .optional();

export const createConnectionBodySchema = z.object({
  kind: z.enum(ConnectorKind),
  name: z.string().trim().min(1).max(100),
  groupId: groupIdSchema,
  color: colorSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

export const updateConnectionBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  groupId: groupIdSchema,
  color: colorSchema,
  config: z.record(z.string(), z.unknown()).default({}),
});

export const groupBodySchema = z.object({ name: z.string().max(100) });

// Write-only: the key goes in here and never comes back out of the API.
export const aiKeyBodySchema = z.object({
  provider: z.enum(AiProvider),
  key: z.string().trim().min(1).max(500),
});

export const settingsBodySchema = z.strictObject({
  theme: z.enum(Theme).optional(),
  quickReactions: z.array(z.string().max(32)).max(20).optional(),
});

export const updateSecretsBodySchema = z.object({
  secrets: z.record(z.string(), z.string()),
});

export const setEnabledBodySchema = z.object({ enabled: z.boolean() });

export const signInBodySchema = z.union([
  z.object({ connectionId: z.uuid() }),
  z.object({ kind: z.enum(ConnectorKind) }),
]);

export const oauthAppBodySchema = z.object({
  clientId: z.string().trim().min(10).max(300),
  clientSecret: z.string().trim().max(300).default(''),
  redirectMode: z.enum(RedirectMode),
});

export const oauthProviderParamSchema = z.enum(OAuthProvider);

export const feedbackBodySchema = z.object({
  verdict: z.enum(RuleVerdict),
  explanation: z.string().max(1000).default(''),
});

/** The shape is checked in full by the rule service; this only bounds the input. */
export const ruleDraftBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  verdict: z.enum(RuleVerdict),
  kind: z.enum(RuleKind),
  predicate: predicateSchema.nullable().optional(),
  criterion: z.string().trim().max(300).nullable().optional(),
  threshold: z.number().min(0.5).max(0.99).optional(),
});

export const ruleStatusBodySchema = z.object({ status: z.enum(RuleStatus) });

export const ruleMoveBodySchema = z.object({ direction: z.enum(MoveDirection) });
