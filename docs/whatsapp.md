# Connecting WhatsApp

Huginn joins your WhatsApp account the way WhatsApp Web does: as a **linked device** of
your phone. It sees the messages sent to you, can answer, react and mark them read as
you, and notices when you answer or read on the phone.

> **Unofficial.** WhatsApp has no API for personal accounts and does not allow other
> apps. Huginn talks to it through [Baileys](https://github.com/WhiskeySockets/Baileys),
> an open-source reimplementation of WhatsApp Web. WhatsApp can restrict numbers that
> use such apps; it mostly does so for spam-like bots, but the risk is not zero. Unlink
> Huginn on the phone at any time to stop.

## Link your phone

*Settings → Add connection → WhatsApp → Link my phone.* A QR code appears (WhatsApp
replaces it every 20 seconds or so; scan the one shown). On the phone: **WhatsApp →
Settings → Linked devices → Link a device**, scan it. The connection appears, named
"WhatsApp", once the phone confirms. The phone lists it as "Huginn".

No camera at hand: *Link with phone number instead* under the code asks for your number
and shows an 8-character code; on the phone, *Link a device → Link with phone number
instead*, and type it.

To disconnect for good, delete the connection in Huginn **and** remove "Huginn" on the
phone under Linked devices.

## What comes in

| In WhatsApp | In Huginn | Default rule |
|---|---|---|
| A direct message to you | direct message | Important |
| A group message that @mentions you | mention | Important |
| A group message answering one of yours | mention | Important |
| Other group messages | message | — (Undecided) |
| You answer (or react) on the phone | that conversation closes | |
| You read it on the phone | those items close | |
| A message is edited | the item's text is updated | |

Reactions, deletions, statuses, channels and group changes do not become items. Media is
noted as `[photo]`, `[voice message]` etc. and not downloaded. Replies from Huginn quote
the message they answer; **Done** sends read receipts, as reading on the phone would
(unless you turned read receipts off in WhatsApp).

## Privacy

- The linked device's keys are the connection's secret: encrypted in Huginn's database
  like any token, and gone when the connection is deleted.
- Message text is stored in Huginn's database, like mail and Slack.
- The default rules are conditions only: **no WhatsApp text goes to a model** unless you
  add a sentence rule, or press Spam / Important *with a reason*.
- Linking gives Huginn no message history, only what arrives from then on. Huginn does
  not show as "online" to your contacts, so the phone keeps its notifications.
- WhatsApp logs out a linked device when the phone has been offline for about 14 days;
  Huginn then shows "link it again".
