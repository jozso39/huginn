# huginn-messenger

Huginn's line to Facebook Messenger. It joins the user's own Facebook account as a Messenger
device (the way the Messenger website does) and passes messages on to Huginn's server as
JSON lines. One process serves one account; the server starts it and talks to it over
stdin and stdout.

It is built on [mautrix-meta](https://github.com/mautrix/meta)'s `messagix` package
(v26.10, tag `v0.2610.0`) and on [whatsmeow](https://github.com/tulir/whatsmeow), which
carries Messenger's end-to-end encrypted chats. Both are AGPL-3.0; Huginn's repository is
public, so the source of this helper is available with it.

## Build

```sh
cd messenger && go build -o bin/huginn-messenger .
```

The module needs Go 1.26 or newer; an older `go` downloads it on its own
(`GOTOOLCHAIN=auto`, the default). The build uses cgo for SQLite, so it needs Xcode's
command line tools.

For the Mac app bundle, Tauri expects the target triple in the name:

```sh
cd messenger && go build -trimpath -ldflags="-s -w" -o bin/huginn-messenger-aarch64-apple-darwin .
```

That binary is about 22 MB. Tests: `cd messenger && go test ./...`.

## Running

```sh
huginn-messenger --data <dir>
```

`<dir>` holds the account's device keys, one SQLite file per Facebook account
(`<dir>/<facebook user id>.db`). It is created with mode 700. Cookies are never written
there: the server keeps them.

Logs go to stderr as JSON lines, without cookie values or message text. The libraries'
logs are kept to errors, because their warnings can include whole sync tables.
`HUGINN_MESSENGER_LOG=debug` opens everything up, message content included.

Closing stdin stops the connection and exits with status 0.

## Protocol

Each line on stdin is a request:

```json
{"id": 1, "method": "connect", "params": {"cookies": {"xs": "…", "c_user": "…", "datr": "…"}}}
```

Each request gets one answer line with the same id. Requests are handled concurrently, so
answers can come back in a different order.

```json
{"id": 1, "result": {"userId": "1000…", "name": "Jana Nováková"}}
{"id": 1, "error": {"code": "Unauthorized", "message": "Facebook ended this session — log in again"}}
```

The error codes are:

| Code | Meaning |
| --- | --- |
| `Unauthorized` | The user has to log in again. |
| `Unavailable` | Facebook or the network failed; try again later. |
| `Validation` | The request was malformed. |
| `Internal` | The helper failed. |

An unreadable line is answered with id `0` and `Validation`.

Events come unasked, one per line: `{"event": {"type": "…", …}}`.

### Methods

`info {}` works without cookies. It describes the login window: the window must pose as
exactly the browser messagix imitates.

```json
{"userAgent": "Mozilla/5.0 (X11; Linux x86_64) … Chrome/141.0.0.0 Safari/537.36",
 "loginUrl": "https://www.facebook.com/",
 "requiredCookies": ["xs", "c_user", "datr"],
 "doneUrlPattern": "^https://www\\.facebook\\.com/(?:messages/(?:e2ee/)?(?:t/[0-9]+/?)?)?(?:\\?.*)?$"}
```

`doneUrlPattern` matches the page a finished login lands on. The login page, a checkpoint
or two-factor authentication don't match it.

`login {cookies}` checks the cookies by loading Messenger. If this account has no device
keys yet, it registers the helper as a new encrypted-chat device of the account and saves
the keys. It doesn't stay connected.

- Result: `{userId, name, cookies}`. `cookies` holds every cookie value as it now stands,
  since Facebook may have refreshed some.
- `Unauthorized`: the cookies are dead, required ones are missing, Facebook wants a
  checkpoint or consent, or the account is suspended.

`connect {cookies}` loads Messenger and connects its socket. Once the socket is up, it
answers `{userId, name}`, starts the encrypted-chat connection and then sends events.

- Calling it again replaces the current connection.
- `Unauthorized`: the cookies are dead, or there are no device keys for the account.
  `connect` never registers a device; only `login` does.

`disconnect {}` stops the connection and answers `{}`.

### Events

**`message`** is one message, incoming or the owner's own:

```json
{"type": "message",
 "id": "mid.$cAAA…",
 "threadId": "100004…",
 "encrypted": false,
 "isGroup": false,
 "threadName": null,
 "senderId": "100004…",
 "senderName": "Jana Nováková",
 "fromMe": false,
 "text": "v pátek?",
 "timestamp": 1760000000000,
 "replyToId": null,
 "initial": false,
 "url": "https://www.facebook.com/messages/t/100004…"}
```

- `fromMe` means the owner sent the message from another device, so Huginn can close the
  conversation.
- `text` is plain text. Attachments become short labels after it: `[photo]`, `[video]`,
  `[voice message]`, `[GIF]`, `[sticker]`, `[<file name>]`, `[<link title>]`, `[location]`.
- `threadName` is set for groups only. `senderName` is `null` when Facebook doesn't say.
- `url` opens the conversation on facebook.com. It uses `/messages/e2ee/t/<id>` for
  encrypted chats.
- `initial` is `true` for messages found while connecting, as opposed to live traffic. On
  the unencrypted side that means messages newer than the thread's read mark, so still
  unread. On the encrypted side it means messages the server held while the helper was
  away; this lasts until whatsmeow reports the backlog done, or for 2 minutes at most.
- **Thread ids:** `threadId` is Messenger's numeric thread key. In a one-to-one chat that
  is the other person's id. When a chat moves to encryption it keeps the same key, so a
  conversation keeps its id. `encrypted` and `url` tell the two transports apart.
- **Not sent:**
  - reactions, edits and unsends
  - admin notices such as "named the group"
  - unsent messages
  - history that is already read

**`read`** means the owner has read the thread up to `timestamp` (unix ms), on another
device or in an earlier session:

```json
{"type": "read", "threadId": "100004…", "timestamp": 1760000000000}
```

It is sent for every thread when connecting, then whenever the mark moves. The sources are:

- Messenger's read marks: the thread rows, `MarkThreadRead`, and the owner's own read
  receipts
- the owner's read receipts in encrypted chats

**`cookies`** carries changed cookie values, to store in place of the old ones:

```json
{"type": "cookies", "cookies": {"xs": "…", "c_user": "…", "datr": "…"}}
```

It is checked after connecting and every 10 minutes.

**`connected`** and **`disconnected`** report the connection while it runs, for example
`{"type": "disconnected", "reason": "Messenger connection dropped; reconnecting"}`. The
helper reconnects on its own:

- The socket retries short drops itself.
- After a permanent socket error or an expired encryption token, the helper sets up the
  whole session again. It waits 5 s, 30 s, 2 min, 10 min, then every 30 min.

**`loggedOut`** is final: `{"type": "loggedOut", "reason": "…"}`. The helper stops; the
user has to log in again. It is sent when:

- Facebook ends the session.
- Messenger drops the helper's device (removed by the owner, or no longer known). In
  this case the local keys are deleted, so the next `login` registers a fresh device.
  The helper never adds itself back without a login, because the owner may have removed
  it on purpose.

### Not yet

Sending, reactions and marking as read are not implemented. They are meant to arrive as
the methods `send`, `react` and `markRead` next to the ones above.
