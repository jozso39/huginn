# Architecture

How Huginn is put together. For coding rules, see [CLAUDE.md](../CLAUDE.md).

## 1. Shape

One Bun process serves the API, the live event stream and the built dashboard, and runs
every connector. State is one SQLite file. In the Mac app that process is a compiled
binary which the shell in `desktop/` starts and shows in its window (§9); in development
it is `bun run dev`.

```
the Mac app's window (dashboard)   ──HTTP + SSE──▶  Bun process  ──▶  SQLite (WAL)
                                                    ├─ Hono routes (interface/http)
external writers (scripts)         ──POST /api/items┤─ services (core/services)
                                                    ├─ ConnectorHost → one connector per connection
                                                    │     Slack (search poll), Gmail (history poll),
                                                    │     GitLab (todo poll), ClickUp (task poll),
                                                    │     Signal (signal-cli, run by Huginn)
                                                    └─ Jev and the chat model, with the user's AI key
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
| `connections` | one row per connected account: kind, name, **group_id** (its category), **color** (`#rrggbb` its items are tinted with), config (JSON, validated by the connector's Zod schema), **cursor** (connector's sync position), status + message, `secrets_ciphertext` | secrets are AES-256-GCM sealed JSON (`AesSecretBox`, key `HUGINN_SECRET_KEY`); never returned by the API. A new connection takes the first palette colour nobody has (`Connection.utils.ts`) |
| `connection_groups` | the categories ("Work", "Personal") connections are shown under; exist on their own, so they are offered even while unused | called groups in code because Category is the triage verdict; names are unique ignoring case; deleting one leaves its connections without a category |
| `settings` | the user's preferences as JSON under one key: theme (System/Light/Dark), quick reactions (emoji) | `SettingsService` keeps what is valid of what an older version stored |
| `items` | one row per message/notification: `external_id` unique per connection, `thread_key`, kind, author, title, **body** (clean plain text — what rules and Jev read), `url` (deep link), **rich** (Slack mrkdwn + names; null for e-mail), **status** (source state pill, e.g. MR Open/Merged/Closed), **features** (flat metadata for rules), `raw` (what the connector needs to act, e.g. Slack event, compact Gmail headers), **category**, **decision** (TriageDecision JSON), state Open/Done/Archived, **search_text** (title, author and body folded to lower case without accents) | re-ingesting the same external id updates content but keeps state and decision; items from before search are indexed at boot |
| `actions` | the archive: every reply, draft, reaction, done, mark-spam/important, with payload and provider result | |
| `rules` | per-connection triage rules: verdict, kind Hard/Soft, predicate / criterion, threshold, **priority**, status Active/Proposed/Disabled, origin Default/User/Feedback, hits | |
| `rule_history` | every rule change: before/after, reason (user's words), item, **checks** (guardrail scores, dry-run numbers) | outlives deleted rules |
| `oauth_apps` | one OAuth client per provider (Google): client id, sealed secret, redirect mode | |

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
| Slack | one `search.messages` per check with the person's own token (PKCE sign-in, rotating tokens refreshed and re-sealed): DMs, mentions (incl. groups), replies in the user's threads, watched or all of their channels minus ignored; own messages close the thread; first sign-in reads the last day | reply (thread or DM), react (emoji → Slack short name) |
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
| `GET /api/items?state=&category=&connectionId=&q=&limit=` | list items; `q` searches (every word must appear; case and accents ignored) |
| `GET /api/items/:id` | item + its actions |
| `GET /api/items/:id/content` | rich content for display (stored, fetched, or text) |
| `POST /api/items` (header `X-Huginn-Key`) | ingest from outside; creates an Ingest connection on first use |
| `POST /api/items/:id/reply` `{text}` · `/draft` `{text}` · `/react` `{emoji}` (the emoji, or a Slack short name) · `/done` · `/reopen` | act |
| `POST /api/items/:id/feedback` `{verdict, explanation}` | Spam / Important (+ learn) |
| `GET /api/connections` · `GET /api/connections/kinds` · `GET /api/connections/:id` | read |
| `POST /api/connections` · `PUT /:id` `{name, config, groupId, color}` · `PUT /:id/secrets` · `PUT /:id/enabled` · `DELETE /:id` | manage; `PUT` restarts the connector only when `config` changed |
| `GET /api/groups` · `POST /api/groups` `{name}` · `PUT /:id` `{name}` · `DELETE /:id` | categories; `POST` returns the existing one when the name is taken |
| `GET /api/settings` · `PUT /api/settings` `{theme?, quickReactions?}` | preferences; quick reactions must be emoji Slack has a name for |
| `GET /api/connections/:id/rules` · `POST /:id/rules` · `POST /:id/rules/dry-run` · `POST /:id/triage` · `GET /:id/fields` | rules of a connection |
| `PUT /api/rules/:id` · `PUT /:id/status` · `POST /:id/move` `{direction}` · `DELETE /:id` | one rule |
| `GET /api/oauth/apps/:provider` · `PUT /api/oauth/apps/:provider` · `POST /api/oauth/sign-in` · `GET /api/oauth/callback` | sign-in |
| `GET /api/events` | SSE: `ItemUpserted`, `ItemChanged`, `ConnectionChanged`, keep-alive `ping` |
| `GET /api/health` | liveness |
| `POST /api/connections/pairings`, `GET …/pairings/:id` | link a phone (Signal): QR code, then poll until Linked/Failed |

Errors are `{error: ErrorCode, message, details}` with 400/401/404/422/502.

## 7. Dashboard (`web/src`)

- `useHuginn` — all state: initial fetch on SSE `open`, then events; refetch when a
  backgrounded tab becomes visible (phones freeze tabs).
- `InboxView` — category tabs; one section per category (a connection without one gets
  its own), collapsed by default (open ones remembered in `localStorage` by id), header
  counts; keyboard `j/k r e i s o`; a toast for results that outlive their card. Cards
  are tinted with their connection's colour: `styles.css` mixes `--tint-mix` of it into
  the surface, so any colour stays a readable shade in both themes.
- `SettingsView` — connections by category with an *Add connection* button, categories
  (`CategoriesManager`, folded), quick reactions (`ReactionsPicker`: typed emoji, checked
  as you type and again on the server) and the theme (`theme.ts`; `index.html` restores
  it before the first paint).
- `CategoryPicker` — choose, filter or create a category (n8n-style combobox), with a
  link to managing them; `ColorPicker` — palette swatches, any other colour, a preview.
- `PairConnect` — linking a phone: QR (uqr, as a data: image) + polling the pairing.
- `ConnectorIcon` — the source's logo (`web/src/assets/logos`, CC0 svg-logos set) or a
  coloured glyph for sources without one; doubles as the deep link.
- `StatusPill` — `item.status` (e.g. an MR's Open / Merged / Closed), coloured by
  `StatusTone` with GitLab's badge colours; connectors set it, refreshed on every sync.
- `ThreadCard` → `MessageBody` (Slack / e-mail / text), category chip + why-line,
  reply/draft/emoji/Spam/Important/Done driven by the connector's `capabilities`.
- `ConnectionsView`, `ConnectionForm` (generated from the config schema), `SignInConnect`
  + `OAuthAppForm` (Google), `RulesView` + `RuleEditor` (condition builder or JSON, soft
  sentence + threshold, dry run), `ArchiveView` (with search over the whole archive).
- The favicon and the header logo come from `icons/web` (Vite's `publicDir`).

## 8. Security model

- **Network**: the server listens on 127.0.0.1 only. In the Mac app, `localAccess`
  answers only under its own host names (a DNS-rebinding page has a foreign Host
  header), takes writes only from its own origin, and serves the API only to the app's
  window: it proves itself once with the launch token from the shell (`/__launch`) and
  then carries a SameSite=Strict, HttpOnly cookie. Open without it: health, the OAuth
  callback (guarded by its one-time `state`) and `POST /api/items` (the ingest key).
- **Secrets**: sealed with AES-256-GCM before storage; the API never returns them; the
  logger redacts common token keys. `.env` holds the master key.
- **Untrusted content**: message text is data. Slack is rendered as React nodes (never
  HTML); e-mail HTML is cleaned and shown in a script-less, network-less sandbox; links
  only `http(s)`/`mailto`. The rule agent sees content marked as untrusted, behind the
  Jev guardrails; its output is schema-validated and checked before going live.
- **Providers**: model calls go through OpenRouter with zero-data-retention routing.

## 9. The Mac app (`desktop/`)

A thin Tauri shell (`desktop/src/lib.rs`) around the server, which does all the work:

- **Start**: the server is bundled as a sidecar (`bun build --compile`,
  `desktop/binaries/`). The shell starts it with `HUGINN_DESKTOP=1`, the data folder and
  port 47823 (it falls back to the next two when taken), and passes the master key and
  a fresh launch token on **stdin** — never in the environment or the process list.
  While it starts, the window shows `desktop/loading/`; once the server says it is
  ready, the window opens `http://127.0.0.1:<port>/__launch?token=…`.
- **Data**: `~/Library/Application Support/cz.cambora.huginn/` — `huginn.db`,
  `master.key` (created once, mode 600), `server.log`, `signal/`. A development build
  (`bun run desktop:dev`) uses `cz.cambora.huginn.dev` next to it, so the two never
  share data; `bun run desktop:dev-data` copies the real data over (and `--back`).
- **Talking back**: the server prints one JSON line per event on stdout
  (`DesktopChannel`): `ready`, `badge` (the number of Important items, shown in the menu
  bar and on the Dock icon) and `notify` (a macOS notification).
- **Links**: the window keeps Huginn's own pages; every other link is handed to macOS
  (`open`), so it opens in the browser or the app it belongs to (Slack).
- **Background**: closing the window hides it; the menu-bar item opens it, checks for
  updates, toggles *Open at Login* (on after the first start) and quits. Quitting stops
  the server with SIGTERM (connectors and signal-cli stop cleanly) and kills it after
  5 s.
- **Updates**: `bun run release 1.2.3` tags a version; GitHub Actions
  (`.github/workflows/release.yml`) builds and signs the update and publishes it with
  `latest.json`. The app checks every hour and installs on restart. The app itself is
  signed ad hoc only, so macOS asks once on the first start.

