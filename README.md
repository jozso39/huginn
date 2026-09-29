# Huginn

> Huginn — Odin's raven of *thought*, who flies over the world every morning and comes
> back to tell him what happened.

One inbox for every channel you have to answer. Huginn pulls what is waiting for you
from Slack, e-mail, GitLab, ClickUp and friends into one self-hosted dashboard, where you
reply, react or mark it done without opening each tool. Every action is archived.

**Status: early, personal.** It runs on one Raspberry Pi for one person. It is being
built in the open and will become configurable for anyone once the shape settles.

## What works today

- **Inbox** grouped by conversation, updated live over Server-Sent Events.
- **Reply** from the dashboard; the message leaves the inbox and lands in the **archive**
  with what you wrote. A follow-up from the other side arrives as a new item in the same
  thread.
- **Done** closes the item here and, where the tool supports it, at the source
  (GitLab todos are marked done).
- The source badge is a deep link to the original message.
- Keyboard: `j`/`k` move, `r` reply, `e` done, `o` open in source.
- **Connectors**:
  - **Slack** — DMs, mentions (yours and your groups'), replies in your threads, watched
    channels; reply and react as you; answering in Slack clears it here.
    Setup: [docs/slack-app.md](docs/slack-app.md).
  - **Gmail** (any number of mailboxes, added with *Sign in with Google*) — unread
    inbox mail; reply in-thread, save as draft, done marks read; reading or answering
    in Gmail clears it here. Setup: [docs/gmail.md](docs/gmail.md).
  - **ClickUp** — tasks newly assigned to you and new comments on your tasks (mentions
    flagged); reply in the comment's thread. Setup: [docs/clickup.md](docs/clickup.md).
  - **LinkedIn** — its notification mails (messages, mentions, invitations) read from
    Gmail, linked to the conversation. Setup: [docs/linkedin.md](docs/linkedin.md).
  - **GitLab** — todos (review requests, mentions, assignments); done marks the todo done.
  - **Ingest API** anything can post to (`POST /api/items` with `X-Huginn-Key`).
- Messages look like they do at the source: Slack's formatting (bold, code, quotes,
  mentions, dates, emoji) rendered like Slack; e-mail as a clean preview that opens into
  the real HTML — in a sandboxed frame with no scripts and no remote images until you
  ask for them.
- Works in laptop and phone browsers, and installs as an app: Chrome → *Install*
  (address bar icon, or ⋮ → *Cast, save and share* → *Install page as app*); on a
  phone, *Add to Home Screen*. Installed, its icon shows how many items are important.
- Connections are added in the UI; tokens are encrypted at rest (AES-256-GCM).

## Triage

Every item is sorted into **Important**, **Undecided** or **Spam** by per-connection
rules; each decision names the rule that made it. Rules are either exact conditions on
the item's fields or one-sentence criteria judged by a small calibrated classifier
([Jev](https://typesafe.ai)). Marking something Spam or Important — and saying why —
lets an agent adjust the rules, fenced by guardrails because messages are untrusted
input. Details: [docs/triage.md](docs/triage.md).

The inbox groups connections (e.g. *Work*, *Personal*); groups start collapsed and show
how much is waiting and how much of it is important.

## Roadmap

1. **More connectors** — LinkedIn (from its notification e-mails in Gmail),
   Signal (linked device).
2. Push only *Important* items to the phone.
3. Backfill for Slack (messages sent while Huginn was offline).

## Running it

Requires [Bun](https://bun.sh) 1.3+.

```bash
bun install
cp .env.example .env        # then fill in the two keys, see the comments
bun run build               # builds the dashboard into web/dist
bun start                   # http://localhost:3000
```

Development: `bun run dev` (server, restarts on change) and `bun run dev:web` (Vite on
:5173, proxies `/api`).

With Docker: `docker compose up -d --build`. The compose file binds to `127.0.0.1`
only — Huginn holds tokens to all your accounts, so put it behind something that
authenticates you (a tailnet, a VPN) rather than on the open internet.

### Posting from a script

```bash
curl -X POST http://localhost:3000/api/items \
  -H "X-Huginn-Key: $HUGINN_INGEST_KEY" -H 'content-type: application/json' \
  -d '{"externalId":"backup-2026-09-28","author":"restic","title":"Backup failed","kind":"Alert"}'
```

`externalId` makes the call idempotent; `threadKey` groups items into one conversation.

## Documentation

- [HANDOFF.md](HANDOFF.md) — project state, decisions and why, what is next
- [docs/architecture.md](docs/architecture.md) — layers, data model, flows, API, security
- [CLAUDE.md](CLAUDE.md) — coding conventions (hexagonal, enforced by ESLint)
- [docs/triage.md](docs/triage.md) — how sorting and learning work
- Connecting: [Slack](docs/slack-app.md) · [Gmail](docs/gmail.md) · [ClickUp](docs/clickup.md) · [LinkedIn](docs/linkedin.md)

## License

MIT
