# Huginn — handoff

**Read this first.** It is the state of the project: what exists, why it was built this
way, what is unverified, what comes next. How the code is organised is in
[docs/architecture.md](docs/architecture.md); the coding rules are in
[CLAUDE.md](CLAUDE.md). Last updated **2026-09-29** (evening).

> The author's own deployment (host names, where keys live, which accounts are
> connected) is deliberately **not** in this public repo. It is in the private ops notes
> of the machine Huginn runs on (`~/work/HANDOFF.md`, section "Project: Huginn", on the
> author's Raspberry Pi).

---

## 1. What Huginn is

A self-hosted notification hub: one inbox for every channel its owner has to answer.
Connectors pull what is waiting from Slack, Gmail, GitLab, ClickUp (Signal and LinkedIn
planned) into one dashboard; each item can be replied to, reacted to, saved as a draft
or marked done without opening the source tool. Every item is **triaged** into
Important / Undecided / Spam by per-connection rules, and the rules learn from the
owner's Spam / Important clicks.

Guiding goals, in the owner's words: *one place for all communication, pre-filtered;
personal first, modular for anyone later.* Named after Odin's raven of thought.

## 2. Status (2026-09-29)

**Live and used daily** by the author, on a Raspberry Pi, reached over a tailnet from
a Mac and an iPhone. 8 commits, ~13k lines, **94 tests** (`bun run test`).

| Area | State |
|---|---|
| Inbox, reply, react, draft, done, archive, live updates (SSE) | done |
| Categories (n8n-style picker, created on the spot, managed in Settings; inbox sections collapsed by default with waiting/important counts) | done |
| Settings page: connections by category + *Add connection*, categories, quick reactions (typed emoji, validated), theme System/Light/Dark | done |
| Connection colours (palette or any colour, mixed into the background so text stays readable) | done |
| Archive search (every word, case and accents ignored, over the whole archive) | done |
| Connectors: **Slack** (Socket Mode, user token), **Gmail** (any number, Google sign-in), **GitLab** (todos), **ClickUp** (polling), **Ingest API** | done — see §5 for what is verified live |
| Google sign-in: one shared OAuth app, connections created by signing in, relay page | done, used live |
| Triage: hard + soft (Jev) rules, default rules per connector, rules page, dry run, history | done, running live |
| Learning from Spam / Important + reason (agent + Jev guardrails) | done, first live runs 2026-09-29 (§5) |
| Rendering: Slack mrkdwn like Slack, e-mail HTML in a sandboxed frame | done |
| Installable web app (manifest, service worker, dock badge) | done |
| Push notifications for Important items (Web Push, VAPID; iPhone via Home Screen app) | done, **not yet tried on a phone** |
| Connectors: **LinkedIn** (its notification mails via Gmail), **Signal** (linked device; Huginn runs signal-cli itself over stdin/stdout, offered only where it is installed) | done — see §5 |
| MR state pill (item `status`), ClickUp skips own tasks, Slack replies always thread | done |
| Tokens encrypted at rest; one bad connection cannot crash the server | done |

## 3. Decisions and why

These were argued out with the owner; keep them unless there is a reason.

1. **Its own service, not a Hermes fork.** Hermes (the owner's Signal agent) is a chat
   agent without a message store. Huginn owns ingest, storage and triage; Hermes may
   later *push* into it (`POST /api/items`) and *act* on items (calendar events etc.).
2. **Bun + SQLite + Hono + React, hexagonal like Medevio's `ai-service`.** SQLite because
   the host is a Raspberry Pi (RAM, simple `.backup` snapshots). Layer rules are enforced
   by ESLint (see CLAUDE.md).
3. **Reachable only on a private network** (tailnet). Huginn holds tokens to every
   account the owner has; it must never get a public hostname.
4. **Triage is rules, not a model's mood.** Every decision names one rule. Two kinds:
   *hard* (predicates on metadata, in code, free) and *soft* (one sentence judged by
   **Jev**, TypeSafe's calibrated "System One" classifier, via OpenRouter). Rules run in
   priority order, first match wins; nothing fires → Undecided. Jev is only called
   when a soft rule is reached, all remaining soft rules in one call (~0.5 s, ~$0.00002).
5. **The feedback agent reads message content** (the owner's call), fenced by guardrails:
   Jev input check (metadata only at ≥ 0.6, agent skipped at ≥ 0.85), strict JSON rule
   validated like a hand-written one, and output checks (must move this message, must not
   contradict hand-sorted items, not an over-broad spam rule, Jev: "follows from the
   explanation" ≥ 0.5). Failing a check → the rule waits as a *proposal*.
6. **Google sign-in via one shared OAuth *Web* client + a relay page.** Google only
   redirects to domains the project trusts; a tailnet name may not qualify. A static page
   on a trusted domain forwards `code`+`state` to Huginn; it forwards only to
   `https://*.ts.net` or localhost, and the code is useless without the secret in Huginn.
   Paste-back (Desktop client) was built first and dropped.
7. **E-mail HTML is fetched on demand and never trusted**: sandboxed iframe without
   scripts, CSP with no network until "Load images" (remote images are read-tracking).
8. **ClickUp is polled**: it has no notifications/inbox API ("not on the roadmap",
   2025). Budget: ≤ 25 tasks + 1 query per minute, back off below 15 remaining requests.
9. **Slack cannot know muted channels** (`users.prefs.get` needs a legacy scope new apps
   cannot get — verified). Instead: scope *Only what is addressed to me* (+ watch list)
   or *Everything in channels I am in* (− ignore list).

## 4. Next steps (the owner's priority order, as far as known)

> **2026-10-06: Huginn is a Mac app now.** M1 of [docs/plans/desktop-app.md](docs/plans/desktop-app.md)
> is done: `desktop/` (Tauri shell) + the server as a sidecar, released from GitHub
> (`bun run release <version>` → tag → Actions builds the `.dmg`, the signed update and
> `latest.json`; installed apps check hourly). The Pi deployment is retired (stopped,
> data kept there as a fallback). Jozef's data lives in
> `~/Library/Application Support/cz.cambora.huginn/` (`huginn.db`, `master.key`,
> `server.log`). The update-signing key is in Jozef's Bitwarden and in the repo's
> Actions secrets (`TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]`); losing it means installed
> copies can no longer update. Next: M2 (desktop sign-in for Google, Slack sign-in +
> polling). Sections below describe the server era; the plan supersedes §4.

1. **Owner actions**: link Signal (Settings → Add connection → Signal → scan); add LinkedIn (sign in
   with Google) and set the personal Gmail's *Leave out mail from* to `linkedin.com`;
   turn on LinkedIn's message e-mails (it currently mails only jobs/digests); install
   the Home Screen app on the iPhone and turn notifications on.
2. **Tune the learning loop** from `rule_history.checks` (now also `landed`). A rule
   change that moves the message out of the wrong pile into Undecided counts as
   verified (2026-09-29).
3. Verify live: Signal envelopes (group names, edits, read sync), LinkedIn message mails
   (parser built from templates/subjects, only job/digest mails seen so far), Web Push on
   iOS.
4. Slack backfill (messages sent while Huginn was down), Slack `blocks`-only bot messages.
5. Modular-for-anyone: auth for the dashboard itself, onboarding, per-user settings.

## 5. What is verified live, and what is not

| Thing | Verified? |
|---|---|
| Gmail ×2: sign-in through the relay, sync, triage, HTML view | yes |
| Jev soft rules on real mail | yes (e.g. "Automated notification") |
| Default rules installed on existing connections | yes |
| Slack connection running | yes — but **no real message has arrived yet** (quiet holiday); the event flow is proven only by tests |
| ClickUp connection running | yes — no real comment yet; the *tag* mention format is an assumption (plain `@Name` in text is the fallback) |
| GitLab connector | built and tested, **no live connection** yet |
| Feedback agent (Haiku) writing a rule from a reason | yes, 2026-09-29: 3 reasons → 1 rule live (Gmail, soft), 2 proposals. Guard-in scored 0.12–0.32 on ordinary messages |
| Reply to Slack from Huginn | yes — and it posted top-level in a DM, hence replies now always thread |
| Draft / done against real Gmail / ClickUp | not yet exercised live |
| Chrome "Install app", dock badge | built; not confirmed on the owner's machine |
| Web Push | server + keys live on the Pi; no device subscribed yet |
| LinkedIn parser | run over the owner's 17 real LinkedIn mails: all classified right (jobs, updates, security); no message mail exists yet to test |
| Signal | on the Mac since 2026-10-06: signal-cli 0.14.8 from Homebrew, started by Huginn, `startLink` works; the phone link moved from the Pi (re-linked, the Pi's device to be removed on the phone) |

## 6. Known gaps and quirks

- First Gmail sync takes at most **50** unread mails from the last 7 days.
- Gmail feature `sameDomain` (colleague) exists only on mail ingested after 2026-09-28.
- The built-in Gmail rule *Mailing lists and bulk mail* is blunt: on first run it sent
  46 of 50 waiting mails to Spam. Expected to be refined through feedback.
- Rule hit counts count newly arriving items only, not re-sorts.
- Slack: no backfill; threads the user wrote in *before* connecting are unknown until
  they write again; `message.channels` delivers every channel message (filtered locally).
- Slack app messages: legacy attachments and section/header/context blocks are shown
  like Slack (since 2026-10-01); other block types (images, inputs) and app-only
  buttons are not.
- Emoji: ~150 common shortcodes bundled; others show as `:name:` (like Slack's plain text).
- OAuth sign-in `state` lives in memory (15 min); a restart mid-sign-in means "sign in
  again".
- Losing `HUGINN_SECRET_KEY` loses the stored tokens (connections then show an error
  asking to re-enter them); items, rules and history survive.

## 7. Working on it

```bash
bun run desktop:dev-data        # copy the installed app's data for debugging (Slack, Signal paused)
bun run desktop:dev-data --back # …and back to the installed app when done (quit both first)
bun run desktop:dev             # the Mac app around a dev build (own folder: …huginn.dev)
bun run desktop:build           # Huginn.app + .dmg locally (needs the updater key in env)
bun run release 0.3.0           # bump, tag, push → GitHub builds and publishes the release
bun install
cp .env.example .env            # fill HUGINN_SECRET_KEY and HUGINN_INGEST_KEY
bun run dev                     # server with reload (PORT from .env)
bun run dev:web                 # Vite on :5173, proxies /api
bun run code:check              # eslint + prettier --check + tsc (server and web)
bun run test                    # bun test src web/src
bun run db:generate             # after editing src/infrastructure/db/schema.ts
bun run build                   # web → web/dist, served by the server
```

- A Husky **pre-push** hook runs `code:check` and the tests; a push fails on either.
- Migrations are applied by the server at boot; commit the generated SQL in `drizzle/`.
- Deploy (any Docker host): `git pull && docker compose up -d --build`; the compose file
  binds to `127.0.0.1` only — put it behind a tailnet/VPN (e.g. `tailscale serve`).
- Back up `data/huginn.db` with SQLite's online backup (it runs in WAL mode); keep
  `HUGINN_SECRET_KEY` somewhere safe separately.

### Traps already paid for

1. **`bun test` runs in UTC.** Tests that care about local dates set
   `process.env.TZ` (see `web/src/slack/SlackText.test.tsx`).
2. **Rule changes re-sort waiting items in the background.** Tests that count Jev calls
   or read categories right after a rule change must wait a moment (`settle()`).
3. **Zod v4 JSON Schema**: describe config schemas with `{ io: 'input' }`, or every field
   with a default becomes "required" in the generated form.
4. **Drizzle `notInArray([])`** is a SQL error — guard empty lists.
5. **Structured output from the rule agent**: the predicate comes back as a JSON *string*
   (`predicateJson`) because recursive schemas are fragile in strict mode; it is parsed
   and validated with `predicateSchema` like any hand-written rule.
6. **The web app must never import `src/`**; types are mirrored by hand in
   `web/src/api.types.ts` — change both.
7. **Browser caching**: `index.html` is served `no-cache`, `/assets/*` immutable. Break
   that and phones keep an old app after a deploy.
8. One-off data fixes on a running instance: copy a small Bun script into the container
   (`docker cp`), run it with `bun`, delete it — it can import the app's own utilities.
9. **Push endpoints are allow-listed** (Apple, FCM, Mozilla, Windows): the server POSTs
   to whatever a browser registers, so anything else is refused.
10. **signal-cli never on a port or socket**: JSON-RPC has no auth, so it is Huginn's own
    child on stdin/stdout. Stop it with SIGTERM — a closed stdin makes it abort. Two
    copies of its `signal/` folder must never run at once (`desktop:dev-data --back`
    moves it rather than copying).

## 8. Documentation map

| File | What |
|---|---|
| [README.md](README.md) | what Huginn is, running it |
| [HANDOFF.md](HANDOFF.md) | this file: state, decisions, next steps |
| [CLAUDE.md](CLAUDE.md) | coding rules (hexagonal layout, naming, tests) |
| [docs/architecture.md](docs/architecture.md) | layers, data model, flows, API, security |
| [docs/triage.md](docs/triage.md) | rules, Jev, learning from feedback (user-facing) |
| [docs/slack-app.md](docs/slack-app.md), [docs/gmail.md](docs/gmail.md), [docs/clickup.md](docs/clickup.md) | connecting each source |
| [docs/oauth-relay.html](docs/oauth-relay.html) | the OAuth relay page (deploy anywhere static) |
