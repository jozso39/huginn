# Connecting LinkedIn

LinkedIn has no API for messages or notifications, and scraping it breaks its terms.
What it does have is e-mail: Huginn reads LinkedIn's notification mails from your Gmail
and turns them into LinkedIn items that link straight to the conversation or post.

## Set up

1. **In LinkedIn**, make it e-mail you about what you want to see: *Settings →
   Communications → Email* (or *Notifications → Email*), and switch on at least
   **Conversations → Messages** (and *InMail*, *Invitations*, *Mentions* if you like).
   Without this LinkedIn sends only digests and job mail.
2. **In Huginn**, *Connections → Add → LinkedIn (via Gmail)* → *Sign in with Google*
   with the account LinkedIn mails. It uses the same Google sign-in app as Gmail.
3. On that account's **Gmail** connection, **Edit → Leave out mail from:
   `linkedin.com`**, so the same mail does not show up twice.

## What comes in

Unread LinkedIn mail in the inbox, from any tab (Gmail files it under *Social*).
LinkedIn names the template of every mail (`X-LinkedIn-Template`), which is how they
are told apart:

| Mail | Item | Default rule |
|---|---|---|
| Someone messaged you / InMail | direct message, from that person | Important |
| Mentioned or tagged you, replied to you | mention | Important |
| Invitation to connect | todo | — (Undecided) |
| Security (new sign-in, verification) | alert | — (Undecided) |
| Jobs, "hiring", digests, posts, newsletters | alert | Spam |

The link opens the conversation (or post, invitation list, job) on LinkedIn; tracking
parameters and sign-in tokens from the mail are removed.

## Limits

- **No Reply from Huginn**: answering LinkedIn's mail does not reach the person. Open
  the item (its icon) and answer on LinkedIn. **Done** marks the mail read.
- LinkedIn may batch several messages into one mail; the item shows what the mail says.
- Only what LinkedIn e-mails, when it e-mails it (sometimes delayed or skipped if you
  were active on LinkedIn at the time).
