# Connecting Signal

Huginn joins your Signal account the way Signal Desktop does: as a **linked device**
of your phone. It then sees the messages sent to you, can answer and react as you, and
notices when you answer or read on the phone. It is not a bot and needs no number of
its own.

## How it works

A [signal-cli](https://github.com/AsamK/signal-cli) daemon on the Huginn host holds the
linked device. Huginn talks to it over a **Unix socket** mounted into the container —
never a network port, because whoever can talk to the daemon can read and send as you.

```
phone ──Signal servers── signal-cli daemon ──unix socket── Huginn container
```

## Set up (once, on the host)

1. Install signal-cli (on arm64 use the JVM build; see its README) so that
   `signal-cli --version` works.
2. Install the service: copy [deploy/signal-huginn.service](../deploy/signal-huginn.service)
   to `~/.config/systemd/user/`, then
   `loginctl enable-linger $USER && systemctl --user daemon-reload && systemctl --user enable --now signal-huginn`.
   It creates `./signal/signal.sock` next to `docker-compose.yml`.
3. In Huginn's `.env`: `HUGINN_SIGNAL_SOCKET=/app/signal/signal.sock`, then
   `docker compose up -d`.

## Link your phone

*Connections → Add → Signal → Link my phone.* A QR code appears. On the phone: **Signal
→ Settings → Linked devices → +**, scan it. The connection appears (named after your
number) within a few seconds of the phone confirming. The phone lists it as "Huginn";
removing it there disconnects Huginn.

## What comes in

| In Signal | In Huginn | Default rule |
|---|---|---|
| A direct message to you | direct message | Important |
| A group message that @mentions you | mention | Important |
| Other group messages | message | — (Undecided) |
| You answer on the phone | that conversation closes | |
| You read it on the phone | those items close | |
| A message is edited | the item's text is updated | |

Reactions, deletions and group changes do not become items. Attachments are noted as
`[image]` etc. and not downloaded — open the phone for those. Replies from Huginn quote
the message they answer; the quick reactions work too.

## Privacy

- Message text is stored in Huginn's database (and its backups), like mail and Slack.
- The default rules are conditions only: **no Signal text goes to a model** unless you
  add a sentence rule, or press Spam / Important *with a reason* (then the rule agent
  reads that one message, through the zero-retention route and the guardrails).
- Linking gives Huginn no message history — only what arrives from then on.
- Signal unlinks a device that stays offline for about 30 days; Huginn then shows
  "link the phone again".
