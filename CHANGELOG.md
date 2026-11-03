# Changelog

What changed in each version of Huginn. A version's section is its release notes on
GitHub, and Huginn links to them after it updates. Add each change under
**Unreleased** (start that heading when it is missing); `bun run release 1.2.3` turns it
into the section of 1.2.3.

## Unreleased

- **Settings → Updates**: the version you run and what is new in it, where updating
  stands (up to date, a newer version available, installing, ready to restart),
  **Check for updates**, and a switch for automatic updates. Switched off, Huginn still
  checks every hour and tells you, but installs only when you click **Install**.
- After an update, a strip at the bottom says which version is installed and links to
  what changed in it.
- Release notes list what changed in the version. How to install is in the
  [README](https://github.com/jozso39/huginn#install).

## 0.6.0 — 2026-10-25

- **Messenger**: your own Facebook Messenger, encrypted chats included. You log in on
  Facebook's own page in a Huginn window; Huginn never sees your password. Reads only
  for now: writing or reading a chat in Messenger closes it in Huginn.
- **Gmail**: links open the thread in the right account. New setting *Done moves the
  e-mail to Trash* (Gmail and LinkedIn); with it off, a **Delete** button does that.
- **Inbox**: the pointer selects a message; a right-click menu with Reply, reactions,
  Done, Important, Spam, Open, Copy link and Copy text; three orders: by category, by
  source, or newest first.
- **LinkedIn**: an InMail shows only what the person wrote; a "just messaged you" mail
  says who wrote and how many messages wait.

## 0.5.0 — 2026-10-15

- **WhatsApp**: your own account as a linked device (a QR code, or an 8-character
  code). Direct messages, and group messages that mention or answer you; reply, react
  and mark read as you. Answering or reading on the phone closes it in Huginn.
- Once an update is installed, a strip at the bottom offers **Restart to update**.
- A connection's colour is a straight bar beside its messages, thicker on hover.

## 0.4.0 — 2026-10-07

- A **side panel** (`⌘B`) with everything waiting, by category and connection, and
  keyboard shortcuts for the inbox.
- Links open in your browser from the Mac app.
- A setup guide beside every connection's form, cut to the steps.
- Google sign-in comes straight back to the Mac app; after a sign-in in the browser,
  Huginn opens the new connection's settings.

## 0.3.0 — 2026-10-06

- **Settings**: categories, connection colours, quick reactions, a light and a dark
  theme; the archive is searchable.
- **Sign in with Slack**, and the AI key for triage in Settings → AI Triage.
- **Signal** on the Mac: Huginn runs signal-cli itself.
- Slack: every emoji Slack knows by name, tables, and messages that apps add blocks to.
- The menu-bar icon follows a light or dark menu bar.

## 0.2.1 — 2026-10-06

- Mac app fixes: Google sign-ins refresh, connections can be removed, links open.

## 0.2.0 — 2026-10-06

- The first Mac app: Huginn runs on your Mac, lives in the menu bar and updates itself.
- Connections: Slack, Gmail (any number), GitLab, ClickUp, LinkedIn (from its e-mails)
  and Signal.
- Triage into Important, Undecided and Spam by rules, learning new rules from the
  reasons you give.
