import { z } from 'zod';
import { ConnectorKind } from '@/core/connections/Connection.types';
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

export const createConnectionBodySchema = z.object({
  kind: z.enum(ConnectorKind),
  name: z.string().trim().min(1).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

export const updateConnectionBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const updateSecretsBodySchema = z.object({
  secrets: z.record(z.string(), z.string()),
});

export const setEnabledBodySchema = z.object({ enabled: z.boolean() });
