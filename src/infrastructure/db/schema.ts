import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Enums are stored as their string value; the core enums are the source of truth
// and the stores cast on the way out. Dates are epoch milliseconds.

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  config: text('config', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  cursor: text('cursor', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  // AES-GCM sealed JSON of the connector's tokens. Never plaintext.
  secretsCiphertext: text('secrets_ciphertext').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  status: text('status').notNull(),
  statusMessage: text('status_message'),
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    threadKey: text('thread_key').notNull(),
    kind: text('kind').notNull(),
    author: text('author').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    features: text('features', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    raw: text('raw', { mode: 'json' }).notNull().$type<unknown>(),
    category: text('category').notNull(),
    decidedByRuleId: text('decided_by_rule_id'),
    state: text('state').notNull(),
    stateChangedAt: integer('state_changed_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('items_connection_external').on(table.connectionId, table.externalId),
    index('items_state_received').on(table.state, table.receivedAt),
    index('items_thread').on(table.threadKey),
  ]
);

export const actions = sqliteTable(
  'actions',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    result: text('result', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('actions_item').on(table.itemId)]
);
