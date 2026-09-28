# Huginn

Self-hosted notification hub: connectors pull messages from Slack, Gmail, GitLab,
ClickUp, … into one inbox where they are answered, reacted to, or marked done.
Bun + TypeScript, SQLite (Drizzle), Hono, a Vite/React SPA in `web/`.

Run `bun run code:check && bun run test` after any change and fix everything it reports.

## Architecture — hexagonal, strictly

```
src/
├── core/            business logic and contracts — never imports infrastructure/, interface/ or dependency/
├── infrastructure/  implements core interfaces: SQLite stores, API clients, connectors
├── interface/http/  Hono routes — parse with Zod, call a core service, respond
├── dependency/      the DI container (container.ts) and its test twin (testContainer.ts)
└── lib/             env, config, logger
web/                 the SPA — talks to the server over HTTP only, never imports src/
```

ESLint enforces the layer boundaries; do not disable those rules.

- **Contracts live in `*.types.ts`** in `core/`, interfaces prefixed `I` (`IItemStore`).
  Implementations in `infrastructure/` sit in a folder named after the class.
- **No barrel files** (`index.ts` re-exports are banned).
- **Constructor injection**: `logger` first when present, then one `private readonly`
  parameter per dependency. No `deps` objects. Config objects may be one parameter.
- **Enums over string literals**, PascalCase key equal to value (`Open = 'Open'`),
  validated with `z.enum(E)`.
- **Zod v4 standalone forms**: `z.uuid()`, `z.url()`, `z.iso.datetime()`, `z.int()`.
- Class modules keep helpers `private` / `private static`; shared pure helpers go in
  `*.utils.ts`. Do not export internals for tests.
- Arrow functions, early returns, `Promise.all` over awaiting in a loop, type-only imports,
  immutable updates (`functional/immutable-data`).
- Comments explain *why*, not *what*.

## Tests

`bun test src`. Always build the graph with `createTestContainer()` — real stores on an
in-memory SQLite, real services, mocked external clients (`*.mock.ts` beside the real
client). Never mock modules, config or the logger. Go through public methods.

## Connectors

A connector is an `IConnectorFactory` (config schema, secret fields, `create()`) plus an
`IConnector` (`start/stop`, optional `reply/react/ack`). Register the factory in
`dependency/container/container.ts`; the settings form is generated from its schema.
Connectors never touch stores: they get a `ConnectorContext` (`upsert`, `closeOpenExcept`,
cursor, status) from `ConnectorHost`. Map provider payloads to items in a pure
`*.utils.ts` with a unit test and a fixture in the client's mock.

## Secrets

Connector tokens are sealed with AES-GCM (`HUGINN_SECRET_KEY`) before they reach SQLite
and are never returned by the API. Never log a token; the logger redacts common keys but
that is a backstop, not a licence.

## Migrations

Edit `src/infrastructure/db/schema.ts`, then `bun run db:generate` and commit the SQL in
`drizzle/`. The server applies pending migrations at boot.
