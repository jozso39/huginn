# Connecting Signal

Huginn joins your Signal account the way Signal Desktop does: as a **linked device**
of your phone. It then sees the messages sent to you, can answer and react as you, and
notices when you answer or read on the phone. It is not a bot and needs no number of
its own.

## What it needs

[signal-cli](https://github.com/AsamK/signal-cli) on the Mac. Huginn does not ship it,
so Signal is offered under *Settings → Add connection* only once it is installed:

```bash
brew install signal-cli
```

Homebrew's build is a native program (about 120 MB, no Java). Huginn finds it on `PATH`
or in Homebrew's folders; `HUGINN_SIGNAL_CLI` points to a copy anywhere else.

## How it works

Huginn starts signal-cli itself the first time Signal is used and stops it when Huginn
quits. They talk JSON-RPC over signal-cli's stdin and stdout, never a socket or a port,
because whoever can talk to signal-cli can read and send as you. If signal-cli crashes,
Huginn starts it again.

```
phone ──Signal servers── signal-cli (run by Huginn) ──stdin/stdout── Huginn
```

signal-cli keeps the linked device's keys in `signal/` inside Huginn's data folder
(`~/Library/Application Support/cz.cambora.huginn/signal`), next to the database and
readable only by you. While Huginn is not running, or the connection is paused, new
messages wait on Signal's servers and come in when it is back.

## Link your phone

*Settings → Add connection → Signal → Link my phone.* A QR code appears. On the phone: **Signal
→ Settings → Linked devices → +**, scan it. The connection appears (named after your
number) within a few seconds of the phone confirming. The phone lists it as "Huginn".

To disconnect for good, delete the connection in Huginn **and** remove "Huginn" on the
phone under Linked devices. Only the phone can cut the link.

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
- The `signal/` folder is as sensitive as Signal Desktop's own: whoever copies it can
  read your new messages until you remove the device on the phone.
- The default rules are conditions only: **no Signal text goes to a model** unless you
  add a sentence rule, or press Spam / Important *with a reason* (then the rule agent
  reads that one message, through the zero-retention route and the guardrails).
- Linking gives Huginn no message history — only what arrives from then on.
- Signal unlinks a device that stays offline for about 30 days; Huginn then shows
  "link the phone again".
