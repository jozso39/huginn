# Architecture

How Huginn is put together. For *why* and *what next*, see [HANDOFF.md](../HANDOFF.md);
for coding rules, [CLAUDE.md](../CLAUDE.md).

## 1. Shape

One Bun process serves the API, the live event stream and the built dashboard, and runs
every connector. State is one SQLite file.

```
browser (dashboard, installable)  ──HTTP + SSE──▶  Bun process  ──▶  SQLite (WAL)
                                                    ├─ Hono routes (interface/http)
external writers (scripts, Hermes) ──POST /api/items┤─ services (core/services)
                                                    ├─ ConnectorHost → one connector per connection
                                                    │     Slack (Socket Mode), Gmail (history poll),
                                                    │     GitLab (todo poll), ClickUp (task poll)
                                                    └─ Jev (OpenRouter System One), chat model (OpenRouter)
```

## 2. Layers

```
src/
├── core/            domain types, contracts (I-prefixed interfaces), services, pure rules
│   ├── items/ connections/ actions/ triage/ oauth/ events/ secrets/ errors/
│   ├── clients/<X>Client/<X>Client.types.ts      what core needs from an external system
│   └── services/<X>Service/                      business logic, tests next to it
├── infrastructure/  implementations: SQLite stores, API clients, connectors, crypto, event bus
├── interface/http/  Hono routes: parse (Zod) → call a service → respond
├── dependency/      container.ts wires everything; testContainer.ts = same graph, mocked clients
└── lib/             env (Zod-validated), config, logger (pino, redacts tokens)
web/src/             React SPA; talks HTTP only
```

`core` never imports `infrastructure`, `interface` or `dependency` (ESLint enforces it;
core *tests* may use `dependency/testContainer`). Mocks live beside what they mock:
`infrastructure/clients/X/X.mock.ts`, or `core/clients/X/X.mock.ts` when the contract has
no infrastructure implementation worth mocking separately (Jev, the chat model).

## 3. Data model (SQLite, Drizzle — `src/infrastructure/db/schema.ts`)

| Table | Holds | Notes |
|---|---|---|
| `connections` | one row per connected account: kind, name, **group_name**, config (JSON, validated by the connector's Zod schema), **cursor** (connector's sync position), status + message, `secrets_ciphertext` | secrets are AES-256-GCM sealed JSON (`AesSecretBox`, key `HUGINN_SECRET_KEY`); never returned by the API |
| `items` | one row per message/notification: `external_id` unique per connection, `thread_key`, kind, author, title, **body** (clean plain text — what rules and Jev read), `url` (deep link), **rich** (Slack mrkdwn + names; null for e-mail), **status** (source state pill, e.g. MR Open/Merged/Closed), **features** (flat metadata for rules), `raw` (what the connector needs to act, e.g. Slack event, compact Gmail headers), **category**, **decision** (TriageDecision JSON), state Open/Done/Archived | re-ingesting the same external id updates content but keeps state and decision |
| `actions` | the archive: every reply, draft, reaction, done, mark-spam/important, with payload and provider result | |
| `rules` | per-connection triage rules: verdict, kind Hard/Soft, predicate / criterion, threshold, **priority**, status Active/Proposed/Disabled, origin Default/User/Feedback, hits | |
| `rule_history` | every rule change: before/after, reason (user's words), item, **checks** (guardrail scores, dry-run numbers) | outlives deleted rules |
| `oauth_apps` | one OAuth client per provider (Google): client id, sealed secret, redirect mode | |
| `push_devices` | browsers subscribed to Web Push: endpoint (unique), p256dh, auth, label | a push answered 404/410 removes the device |

Migrations: `drizzle/000N_*.sql`, applied at boot (`SqliteDatabase.migrate`).

## 4. Main flows

### New item arrives
1. A connector (running under `ConnectorHost`) calls `ctx.upsert(newItem)`.
2. `ConnectorHost` stores it; **if new**, `TriageService.triage` classifies it and stores the
   decision; then `ItemUpserted` goes on the `EventBus`.
3. `/api/events` (SSE) pushes the event to every open dashboard.

Connectors also call `ctx.closeThread(threadKey)` (the user answered at the source),
`ctx.closeItems(ids)` / `ctx.closeOpenExcept(ids)` (dealt with at the source), and
`ctx.setCursor(...)` / `ctx.report(status, message)`.

### Triage (`core/services/TriageService`)
1. Active rules of the connection, by priority.
2. Walk them: a **hard** rule evaluates its predicate (`core/triage/predicate.utils.ts`:
   conditions on `author/title/body/kind` or any feature, combined with all/any/not).
3. On the first **soft** rule reached, ask Jev about *all remaining* soft rules in one
   `nouls` call (state = source, kind, from, title, body ≤ 2000 chars, features).
4. First rule that fires decides (soft: probability ≥ threshold). None → Undecided
   (`NoRule`, or `ClassifierUnavailable` if Jev failed/unconfigured).
5. Items the user sorted by hand (`decision.source = User`) are never re-sorted.

`retriage(connectionId)` re-runs over open items after any rule change (in the
background; moved items are announced). `dryRun(draft)` shows where a draft would fire
among the last 50 items and counts conflicts with hand-sorted items.

### Spam / Important (`core/services/FeedbackService`)
1. Move the item at once (`decision.source = User`), record a `MarkSpam/MarkImportant` action.
2. No reason, or no API key → done.
3. Jev input guardrail on the message → full content / metadata only / no agent.
4. Chat model (OpenRouter, `provider.zdr`) gets: explanation, message (as untrusted data),
   current rules, fields with sample values → `{action: create|update|none, …}` (strict
   JSON schema).
5. Validate like any rule; place a new rule just before the rule that got it wrong.
6. Checks: would it move this message (re-classify with the rule in place), dry run
   conflicts, over-broad spam, Jev "follows from the explanation". Pass → live; fail →
   `Proposed` (a live rule is never changed on a failed check).
7. `rule_history` records reason and checks; the dashboard shows one sentence.

### Google sign-in (`ConnectionService.beginSignIn / completeSignIn`, `OAuthAppService`)
1. The Google OAuth *Web* client is stored once (`oauth_apps`).
2. `POST /api/oauth/sign-in {kind}` (new account) or `{connectionId}` (re-sign) → URL;
   `state = <uuid>.<base64url(HUGINN_PUBLIC_URL)>`, kept in memory 15 min, single use.
3. Google → redirect URI: either `HUGINN_PUBLIC_URL/api/oauth/callback` (Direct) or the
   relay page (`docs/oauth-relay.html`, Relay), which reads the second half of `state`
   and forwards the query to that Huginn (only `https://*.ts.net` or localhost).
4. `GET /api/oauth/callback` → exchange code (scopes `openid email gmail.modify`) →
   refresh token + email from the ID token → create the connection named after the
   email, or refresh the one that account already has → default rules → start.

### Showing a message
- Slack: `item.rich` (mrkdwn + user/channel/group names) → `web/src/slack/SlackText.tsx`,
  a scanner implementing Slack's rules (see its header comment and tests).
- E-mail: `item.body` is a cleaned preview; `GET /api/items/:id/content` asks the
  connector (`IConnector.content`) → Gmail message → cleaned HTML → `EmailFrame`:
  `srcdoc` iframe, `sandbox` without scripts, CSP `default-src 'none'` (images only
  after "Load images"), `<base target=_blank>`.

## 5. Connectors

A connector is two parts (`core/connectors/Connector.types.ts`):

- **`IConnectorFactory`** — `kind`, `label`, `capabilities` (reply/draft/react/ack),
  `configSchema` (Zod; the settings form is generated from its JSON Schema, `title`,
  `description`, `optionLabels` via `.meta()`), `secretFields`, optional `authorization`
  (OAuth), optional `defaultRules`, and `create(connection, secrets, app)`.
- **`IConnector`** — `start(ctx)` / `stop()`, optional `reply`, `draft`, `react`, `ack`,
  `content`.

`ConnectorHost` runs one per enabled connection, restarts failed starts with backoff
(5 s → 10 min), parks connections in `NeedsAuth` when a sign-in is missing, and turns
unreadable secrets into an error on that connection only.

| Connector | Receives | Acts |
|---|---|---|
| Slack | Socket Mode events (user token): DMs, mentions (incl. groups), replies in the user's threads, watched or all channels minus ignored; own messages close the thread | reply (thread or DM), react |
| Gmail | `history.list` every 60 s; first sync = unread inbox ≤ 50 from 7 days; read/archived/answered elsewhere closes | reply in thread, draft, done = mark read, content = HTML |
| GitLab | `GET /todos` every 60 s; a todo gone at GitLab closes the item | comment on MR/issue, done = mark todo done |
| ClickUp | tasks assigned to the user changed since cursor (≤ 25/min) + their comments; new assignments; own comment closes | reply in comment thread / task comment |
| Ingest | nothing — `POST /api/items` with `X-Huginn-Key` | — |

**Adding one:** client contract in `core/clients/X`, implementation + mock in
`infrastructure/clients/X`, pure mapping in `infrastructure/connectors/XConnector/*.utils.ts`
(with a test and fixtures in the mock), connector + factory, register in `container.ts`
and `testContainer.ts`, default rules in `infrastructure/connectors/defaultRules.ts`,
an end-to-end test through `createTestContainer`, a `docs/<x>.md`.

## 6. HTTP API (`src/interface/http`)

| Method & path | Does |
|---|---|
| `GET /api/items?state=&category=&connectionId=&limit=` | list items |
| `GET /api/items/:id` | item + its actions |
| `GET /api/items/:id/content` | rich content for display (stored, fetched, or text) |
| `POST /api/items` (header `X-Huginn-Key`) | ingest from outside; creates an Ingest connection on first use |
| `POST /api/items/:id/reply` `{text}` · `/draft` `{text}` · `/react` `{emoji}` · `/done` · `/reopen` | act |
| `POST /api/items/:id/feedback` `{verdict, explanation}` | Spam / Important (+ learn) |
| `GET /api/connections` · `GET /api/connections/kinds` · `GET /api/connections/:id` | read |
| `POST /api/connections` · `PUT /:id` `{name, groupName, config}` · `PUT /:id/secrets` · `PUT /:id/enabled` · `DELETE /:id` | manage |
| `GET /api/connections/:id/rules` · `POST /:id/rules` · `POST /:id/rules/dry-run` · `POST /:id/triage` · `GET /:id/fields` | rules of a connection |
| `PUT /api/rules/:id` · `PUT /:id/status` · `POST /:id/move` `{direction}` · `DELETE /:id` | one rule |
| `GET /api/oauth/apps/:provider` · `PUT /api/oauth/apps/:provider` · `POST /api/oauth/sign-in` · `GET /api/oauth/callback` | sign-in |
| `GET /api/events` | SSE: `ItemUpserted`, `ItemChanged`, `ConnectionChanged`, keep-alive `ping` |
| `GET /api/health` | liveness |
| `GET /api/push`, `POST /api/push/devices`, `…/devices/remove`, `…/test` | Web Push: VAPID public key + devices; subscribe, forget, test |
| `POST /api/connections/pairings`, `GET …/pairings/:id` | link a phone (Signal): QR code, then poll until Linked/Failed |

Errors are `{error: ErrorCode, message, details}` with 400/401/404/422/502.

## 7. Dashboard (`web/src`)

- `useHuginn` — all state: initial fetch on SSE `open`, then events; refetch when a
  backgrounded tab becomes visible (phones freeze tabs).
- `InboxView` — category tabs; groups by `connection.groupName ?? name`, collapsed by
  default (open ones remembered in `localStorage`), header counts; keyboard
  `j/k r e i s o`; a toast for results that outlive their card.
- `NotificationsPanel` (Connections page) — Web Push on/off per device, test, device list;
  `web/public/sw.js` shows pushes and sets the app badge.
- `PairConnect` — linking a phone: QR (uqr, as a data: image) + polling the pairing.
- `ConnectorIcon` — the source's logo (`web/src/assets/logos`, CC0 svg-logos set) or a
  coloured glyph for sources without one; doubles as the deep link.
- `StatusPill` — `item.status` (e.g. an MR's Open / Merged / Closed), coloured by
  `StatusTone` with GitLab's badge colours; connectors set it, refreshed on every sync.
- `ThreadCard` → `MessageBody` (Slack / e-mail / text), category chip + why-line,
  reply/draft/emoji/Spam/Important/Done driven by the connector's `capabilities`.
- `ConnectionsView`, `ConnectionForm` (generated from the config schema), `SignInConnect`
  + `OAuthAppForm` (Google), `RulesView` + `RuleEditor` (condition builder or JSON, soft
  sentence + threshold, dry run), `ArchiveView`.
- `public/`: manifest, icons (from `huginn.png`), `sw.js` (pass-through service worker).

## 8. Security model

- **Network**: loopback bind; expose only on a private network. The dashboard has no
  login of its own yet — reachability is the access control. `POST /api/items` needs the
  ingest key.
- **Secrets**: sealed with AES-256-GCM before storage; the API never returns them; the
  logger redacts common token keys. `.env` holds the master key.
- **Untrusted content**: message text is data. Slack is rendered as React nodes (never
  HTML); e-mail HTML is cleaned and shown in a script-less, network-less sandbox; links
  only `http(s)`/`mailto`. The rule agent sees content marked as untrusted, behind the
  Jev guardrails; its output is schema-validated and checked before going live.
- **Providers**: model calls go through OpenRouter with zero-data-retention routing.
