# Connecting Gmail

One Gmail connection per mailbox; add it twice for a personal and a work account.
Both can use the same Google OAuth client.

## What it can do

Huginn asks for one permission, `gmail.modify`: read mail, send, create drafts and change
labels (mark read). It can move mail to Trash but **cannot delete mail permanently**.

| In Huginn | In Gmail |
|---|---|
| New unread mail in your inbox | appears within a minute |
| **Reply** | sent in the same thread, as you |
| **Save as draft** | a draft in that thread; the item stays open until you send it |
| **Done** | the mail is marked read |
| You read, archive or answer a mail in Gmail | it leaves Huginn too |

Mail that arrives while Huginn is offline is caught up when it comes back (Gmail keeps
about a week of history). The first sync picks up unread inbox mail from the last 7 days.

**Which mail** decides the inbox tabs: *Primary only*, *Everything except Promotions*
(default) or *All inbox mail*. Workspace accounts usually have no tabs and get everything.

## 1. An OAuth client

You need a Google OAuth client ID and secret.

- **If you already have a "Desktop app" client** (for example the one another tool of
  yours signs in with), reuse it. Choose *Desktop app* as the client type in Huginn.
- **Otherwise**: [Google Cloud console](https://console.cloud.google.com) → pick or create
  a project → *APIs & Services* → enable the **Gmail API** → *Credentials* →
  *Create credentials* → *OAuth client ID* → type **Desktop app**. The consent screen
  must list your account as a test user, or be published — an app left in *Testing*
  loses its sign-in after 7 days.

A **Web application** client also works and skips the paste step: give it the redirect
URI `https://<where Huginn runs>/api/oauth/callback`, set `HUGINN_PUBLIC_URL` to that
address in Huginn's `.env`, and choose *Web application* as the client type.

## 2. Add the connection

**Connections → Add a connection → Gmail**, name it ("Personal Gmail"), paste the client
ID and secret, **Connect**. It shows **Needs sign-in**.

## 3. Sign in

1. **Sign in with Google** opens Google in a new tab. Pick the mailbox and approve.
   Google may warn that the app is unverified; that is your own app — *Advanced →
   Go to …*.
2. *Desktop client:* Google then sends you to a `http://localhost/…` page that does
   not load. **That is expected.** Copy the whole address from the address bar, paste it
   into Huginn, **Finish sign-in**.
3. The connection turns **Running** and the first sync starts.

The sign-in link is valid for 15 minutes and works once. If Google ever revokes access
(password change, you removed the app at myaccount.google.com), the connection shows
**Needs sign-in** again — repeat step 3; nothing else is lost.
