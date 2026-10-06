# Connecting Slack

Each person **signs in with Slack** and Huginn reads and replies **as them**, with
their own token — no bot, no "sent via" footer, and nothing shared between people.
It needs the company's own Huginn Slack app, which a Slack admin creates once.

## 1. The Slack app (an admin, once per company)

<https://api.slack.com/apps> → **Create New App** → **From a manifest** → pick the
workspace → paste:

```yaml
display_information:
  name: Huginn
  description: An inbox for what needs you. Each person signs in; it reads and replies as them.
  long_description: >-
    Huginn is a desktop inbox for everything that needs you. It brings your Slack direct
    messages, mentions and replies in your threads together with e-mail, ClickUp, GitLab
    and Signal, and sorts them into Important, Undecided and Spam. Each person signs in
    with their own Slack account: Huginn runs on their Mac, reads only what they can
    already see in Slack, and replies or reacts as them. Nothing is shared between people.
  background_color: "#14161a"
oauth_config:
  # Huginn signs in on the Mac it runs on; it uses the first of these ports that is free.
  redirect_urls:
    - http://localhost:47823/api/oauth/callback
    - http://localhost:47824/api/oauth/callback
    - http://localhost:47825/api/oauth/callback
  scopes:
    user:
      - search:read        # what is new since the last check
      - channels:history   # a message in full when search leaves something out
      - groups:history
      - im:history
      - mpim:history
      - channels:read      # channel names for titles, "read in Slack" markers
      - groups:read
      - im:read
      - mpim:read
      - users:read         # people's names instead of U-IDs
      - usergroups:read    # @group mentions of groups you are in
      - chat:write         # reply as you
      - reactions:write    # emoji as you
  # Sign-in from a desktop app without a client secret. Turning it on cannot be undone.
  pkce_enabled: true
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: true
```

There is no separate install step, and the app's settings may offer no Install button:
each person's first **Sign in with Slack** (below) installs it for them. If the
workspace requires approval for apps, that first sign-in asks an admin instead. Keep the
app **internal — never "distribute" it**: internal apps are exempt from Slack's 2025
limits on reading history.

Then share its **Client ID** (Basic Information → App Credentials) with whoever uses
Huginn. It is not a secret: with PKCE there is no client secret at all, and each person
only ever gets their own token.

**Upgrading an app made with the old manifest** (Socket Mode, two pasted tokens): open
it → **App Manifest** → replace it with the one above → Save. Then sign in from Huginn;
its Socket Mode token can be revoked afterwards.

## 2. Sign in (everyone)

**Settings → Add connection → Slack**. The first time on a Mac, paste the Client ID;
then **Sign in with Slack**, approve, and the connection appears (named after the
workspace). Category, colour and which channel messages you want are under **Edit**.
A connection made with pasted tokens before sign-in existed is taken over by the first
sign-in, keeping its items and rules.

Tokens rotate: Huginn refreshes them on its own. A Mac that stays off for a month
needs one more sign-in (Slack's refresh tokens last 30 days).

## What comes in

Always, whatever you choose:

| Comes in | As |
|---|---|
| Direct messages and group DMs | Direct message |
| `@you` or `@a-group-you-are-in` anywhere | Mention |
| Replies in threads you wrote in (or replied to from Huginn) | Message |

On top of that, **Channel messages**:

- **Only what is addressed to me** (default) — nothing else, plus the channels you list
  under *Also watch*.
- **Everything in channels I am in** — every message in every channel you are a member
  of, except the ones under *Ignore*. All of it goes through your rules, and what no
  rule sorts waits in Undecided, so expect volume until your rules catch up.

The form shows *Also watch* or *Ignore*, whichever goes with the choice.

Channel lists take names or IDs, comma-separated: `#general, releases, C084MR7P2UR`.
A name that matches no channel you are in shows as a warning on the connection.

**Why not "everything I have not muted"?** Slack does not tell apps what you muted: the
preferences API needs a legacy `read` scope that newly created apps cannot get (checked
2026-09-28, `users.prefs.get` → `missing_scope`). *Ignore* is the stand-in for your mute
list. Like a Slack mute, it does not silence a direct @mention.

Your own messages close the conversation in Huginn — answer in Slack and the item
disappears here too.

**Replies from Huginn always go into a thread** under the message you answer — in
channels and in DMs alike — so the other side sees which message you mean.

## Read in Slack

**Edit → Read in Slack → Clear it from Huginn** makes Huginn check, once a minute, how
far you have read each conversation that has something waiting (Slack's read marker,
`conversations.info` → `last_read`) and close what you have read — on any device.
Default: *Keep*, so reading on the phone does not make things vanish here.

Thread replies are not covered: their read state is separate and Slack does not give
it to apps. Answering in the thread still closes them.

## How Huginn checks

Every *Check every* interval (default a minute) Huginn runs **one search** for what
is new since the last check, as you, and the rules above pick what is yours. The
search sees what you can see in Slack, so a colleague's Huginn never sees your
messages, and yours never sees theirs.

- **Catching up is natural.** After sleep or a weekend the next check reads what came
  in meanwhile — up to the newest 1,000 messages; past that the connection says some
  were skipped.
- **The first sign-in reads the last day**, so what is still waiting shows up; what you
  already answered closes itself.
- **One rate limit for everyone.** Slack allows the company's app about 20 searches a
  minute in the workspace, shared by everyone who signed in: fine for a team at the
  default minute. If Slack says *busy*, that check is skipped and the next one catches up.
- **Threads you wrote in before connecting** are not known until you write in them again.
