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
  - **GitLab** — todos (review requests, mentions, assignments); done marks the todo done.
  - **Ingest API** anything can post to (`POST /api/items` with `X-Huginn-Key`).
- Works in laptop and phone browsers; on a phone, *Add to Home Screen* gives it its
  own icon and a full-screen window.
- Connections are added in the UI; tokens are encrypted at rest (AES-256-GCM).

## Roadmap

1. **More connectors** — LinkedIn (from its notification e-mails in Gmail),
   ClickUp (polling; it has no notifications API), Signal (linked device).
2. **Triage** — every item lands in *Important*, *Undecided* or *Spam*, decided by
   per-connection **rules** that are traceable: each verdict names the rule that made it.
   *Hard* rules are predicates on metadata, evaluated in code. *Soft* rules are one-line
   criteria evaluated by a System One model ([Jev](https://typesafe.ai)) — one yes/no
   question per rule, all batched in one call, with low confidence falling to *Undecided*.
3. **Learning from feedback** — mark something *Spam* or *Important* and say why; an
   agent turns that into a new or amended rule, shown to you with a dry run over recent
   items before it goes live. Messages are untrusted input, so the agent is fenced by
   guardrail checks on what it reads and on the rule it proposes.
4. **Origin triage** — sensible default rules per connector on day one (a direct
   Slack mention is important; Gmail's own spam is spam).
5. Push only *Important* items to the phone.

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

## Architecture

Hexagonal: `core/` holds the domain and the contracts, `infrastructure/` the SQLite
stores, API clients and connectors, `interface/http/` the thin Hono layer, and
`dependency/` wires it together. Details and conventions in [CLAUDE.md](CLAUDE.md).

## License

MIT
