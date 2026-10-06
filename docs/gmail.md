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

Choosing Gmail the first time opens **Set up Google sign-in once**, with the exact
redirect URI to register. In short:

1. [Google Cloud → Credentials](https://console.cloud.google.com/apis/credentials), in a
   project with the **Gmail API** enabled.
2. **Create credentials → OAuth client ID → Web application.**
3. **Authorised redirect URIs**: add the address Huginn shows (copy button).
4. Paste the client ID and secret into Huginn, **Save**.

The consent screen must be **In production** (or list your accounts as test users —
but a *Testing* app loses its sign-ins after 7 days). Google shows an "unverified app"
warning to you as the owner; *Advanced → Go to …* continues.

### Where Google sends you back

Huginn usually lives on a private address (a tailnet), and Google only redirects to
addresses it accepts for your project. Two ways, chosen in the setup form:

- **Through the relay page** (`HUGINN_OAUTH_RELAY_URL`): Google returns to a small static
  page on a domain your Google project already trusts, which forwards the one-time code
  to your Huginn. The page is [`docs/oauth-relay.html`](oauth-relay.html); host it
  anywhere static and point the variable at it. It forwards only to `https://*.ts.net`
  or localhost, and the code is useless without the client secret, which stays in
  Huginn.
- **Straight back** (`HUGINN_PUBLIC_URL` + `/api/oauth/callback`): simplest, if Google
  accepts your Huginn's address as a redirect URI.

Both need `HUGINN_PUBLIC_URL` — where your browser reaches Huginn.

## If access is revoked

A password change or removing the app at myaccount.google.com turns the connection to
**Needs sign-in**; its **Sign in with Google** button restores it. Nothing else is lost.
