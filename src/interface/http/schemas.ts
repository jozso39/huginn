import { z } from 'zod';
import { ConnectorKind } from '@/core/connections/Connection.types';
import { OAuthProvider, RedirectMode } from '@/core/oauth/OAuthApp.types';
import { MoveDirection } from '@/core/services/RuleService/RuleService.types';
import { predicateSchema } from '@/core/triage/predicate.utils';
import { RuleKind, RuleStatus, RuleVerdict } from '@/core/triage/Rule.types';
import { Category, ItemKind, ItemState } from '@/core/items/Item.types';

export const listItemsQuerySchema = z.object({
  state: z.enum(ItemState).optional(),
  category: z.enum(Category).optional(),
  connectionId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const replyBodySchema = z.object({ text: z.string().trim().min(1).max(10_000) });

export const reactBodySchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_+-]+$/, 'emoji short name without colons'),
});

/** What an external writer may post. Everything else is set by the hub. */
export const ingestBodySchema = z.object({
  connectionId: z.uuid().optional(),
  externalId: z.string().min(1).max(256),
  threadKey: z.string().min(1).max(256).optional(),
  kind: z.enum(ItemKind).default(ItemKind.Alert),
  author: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  body: z.string().max(20_000).default(''),
  url: z.url().nullable().default(null),
  receivedAt: z.iso.datetime().optional(),
  features: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
});

const groupNameSchema = z.string().trim().max(60).nullable().optional();

export const createConnectionBodySchema = z.object({
  kind: z.enum(ConnectorKind),
  name: z.string().trim().min(1).max(100),
  groupName: groupNameSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

export const updateConnectionBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  groupName: groupNameSchema,
  config: z.record(z.string(), z.unknown()).default({}),
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
