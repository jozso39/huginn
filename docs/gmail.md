# Connecting Gmail

Adding a mailbox is **Settings → Add connection → Gmail → Sign in with Google**:
pick the account, approve, and you are back in Huginn with a running connection named
after the address. Do it once per mailbox (personal, work…). Before the first one,
Huginn needs a Google OAuth client — a one-time setup of about five minutes.

## What it can do

Huginn asks for `gmail.modify` (read, send, drafts, mark read) plus `openid email`
(only to learn which address signed in). It can move mail to Trash but **cannot delete
mail permanently**.

| In Huginn | In Gmail |
|---|---|
| New unread mail in your inbox | appears within a minute |
| **Reply** | sent in the same thread, as you |
| **Save as draft** | a draft in that thread; the item stays open until you send it |
| **Done** | the mail is marked read |
| You read, archive or answer a mail in Gmail | it leaves Huginn too |

Mail that arrives while Huginn is offline is caught up when it comes back (Gmail keeps
about a week of history). The first sync picks up unread inbox mail from the last 7 days.
**Which mail** (in the connection's *Edit*) chooses the inbox tabs: *Primary only*,
*Everything except Promotions* (default) or *All inbox mail*.

## One-time setup: the Google sign-in app

Once per Mac, not per mailbox: choosing Gmail (or LinkedIn) the first time opens **Set up
Google sign-in once**. After that, every mailbox is one **Sign in with Google** away;
**Google sign-in settings** next to it changes the client.

Whoever manages the Google Cloud project creates the client once and can hand it to
colleagues:

1. [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials), in a
   project with the **Gmail API** enabled.
2. **Create credentials → OAuth client ID → Web application.**
3. **Authorised redirect URIs**: the addresses Huginn shows (copy buttons). On a Mac
   these are `http://127.0.0.1:47823/api/oauth/callback` and the same with `47824` and
   `47825` — Huginn takes the first free port, so register all three.
4. Paste the client ID and secret into Huginn, **Save**. Colleagues paste the same ID
   and secret; send them privately (a password manager), it is a secret.

### One client, many mailboxes

The client stands for Huginn, not for a mailbox: each mailbox signs in for itself and
gets its own token, so one client serves any number of them. Which accounts may sign in
is set by the project's consent screen:

- **Internal** (a project inside your company's Google organisation): only company
  accounts; no verification, no warning, no user limit. If the Workspace admin restricts
  Gmail under *Security → API controls*, they mark the app trusted.
- **External, In production**: any Google account, work or personal, after a one-time
  "Google hasn't verified this app" screen (*Advanced → Go to …*); at most 100 users. A
  company Workspace may forbid such apps for its accounts.
- **External, Testing**: only the test users you list, and their sign-ins expire after
  7 days. Avoid.

Someone with a personal and a work mailbox in one Huginn needs an External client.

### A Huginn server elsewhere

The Mac app always signs in straight back to itself. A Huginn server on a private
address (`HUGINN_PUBLIC_URL`, e.g. a tailnet) may need the relay page instead: Google
returns to a small static page on a domain your Google project trusts, which forwards the
one-time code to Huginn. The page is [`docs/oauth-relay.html`](oauth-relay.html); host it
anywhere static and set `HUGINN_OAUTH_RELAY_URL` to it. It forwards only to
`https://*.ts.net` or localhost, and the code is useless without the client secret,
which stays in Huginn.

## If access is revoked

A password change or removing the app at myaccount.google.com turns the connection to
**Needs sign-in**; its **Sign in with Google** button restores it. Nothing else is lost.
