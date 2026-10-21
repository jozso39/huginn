# Connecting Messenger

Huginn joins your Facebook Messenger the way the Messenger website does: you log in on
Facebook's own page, and Huginn becomes a device of your account, so encrypted chats
reach it too. For now it **only reads**: messages come in, and what you write or read in
Messenger closes the conversation in Huginn. Answer in Messenger itself.

> **Unofficial.** Meta has no API for personal Messenger accounts and does not allow
> other apps. Huginn talks to it through `huginn-messenger`, a small helper built on
> [mautrix-meta](https://github.com/mautrix/meta)'s messagix (the code Beeper uses).
> Facebook may treat the login as suspicious and ask you to confirm it is you (a
> captcha, a phone number, a new password) before the account works again. Turn on
> two-factor authentication first; it makes that less likely.

Messenger needs the Mac app: the login happens in one of its windows.

## Log in

*Settings → Add connection → Messenger → Log in to Facebook.* A window opens on
Facebook's login page. It has no address bar: its title shows the site you are on, and a
link to any other site opens in your browser instead. Log in there (two-factor included).
Once you are on Facebook's home page, Huginn takes the session's cookies (`xs`, `c_user`,
`datr`, and `sb`, `fr` when present), closes the window, and registers itself as a device
of your account. The connection appears, named "Messenger".

Huginn never sees your password. The window keeps its cookies to itself and forgets them
when it closes, and Facebook's page gets no access to Huginn.

When Facebook ends the session (you logged out everywhere, changed the password, or it
expired), the connection says *log in again*; the same button logs in again.

To disconnect for good, delete the connection in Huginn **and** log the session out in
Facebook: *Settings → Accounts Center → Password and security → Where you're logged in*.

## What comes in

| In Messenger | In Huginn | Default rule |
|---|---|---|
| A message in a one-to-one chat | direct message | Important |
| A message in a group | message | — (Undecided) |
| You write in the chat (anywhere) | that conversation closes | |
| You read the chat (anywhere) | that conversation closes | |
| Unread messages when Huginn connects | come in too | |

Reactions, edits, unsent messages and group changes do not become items. Media is noted
as `[photo]`, `[voice message]`, `[file name]` etc. and not downloaded. **Done** closes the
conversation in Huginn only; Facebook does not learn about it.

## Privacy

- The session's cookies are the connection's secret: encrypted in Huginn's database like
  any token, and gone when the connection is deleted. The device keys for encrypted
  chats live in `messenger/` in Huginn's data folder (one file per account, in a folder
  only your user can open).
- Message text is stored in Huginn's database, like mail and Slack. The helper's logs
  hold neither cookies nor message text.
- The default rules are conditions only: **no Messenger text goes to a model** unless you
  add a sentence rule, or press Spam / Important *with a reason*.

## How it works

The shell opens the login window (`desktop/src/login.rs`) when the server asks for it,
and hands the cookies back over stdin. The server runs one `huginn-messenger` per
Messenger connection (`messenger/`, JSON lines over stdin and stdout; the protocol is in
[messenger/README.md](../messenger/README.md)), starts it again if it dies, and stores
the cookies again whenever Facebook refreshes them.
