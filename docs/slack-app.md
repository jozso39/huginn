# Connecting Slack

Huginn reads Slack **as you** (a user token) and listens over **Socket Mode**, so it needs
no public URL and works from a laptop or a Raspberry Pi behind NAT. It posts replies and
reactions as you, with no bot name or "sent via" footer.

## 1. Create the app from this manifest

<https://api.slack.com/apps> → **Create New App** → **From a manifest** → pick the
workspace → paste:

```yaml
display_information:
  name: Huginn
  description: Personal inbox — reads what is addressed to me, replies as me.
  background_color: "#14161a"
features:
  bot_user:
    # Socket Mode needs an app with a bot user, even though Huginn never uses it.
    display_name: Huginn
    always_online: false
oauth_config:
  scopes:
    user:
      - channels:history   # messages in public channels you are in
      - groups:history     # … private channels
      - im:history         # … direct messages
      - mpim:history       # … group DMs
      - channels:read      # channel names for titles
      - groups:read
      - im:read
      - mpim:read
      - users:read         # people's names instead of U-IDs
      - usergroups:read    # detect @group mentions of groups you are in (optional)
      - chat:write         # reply as you
      - reactions:write    # emoji as you
    bot:
      - chat:write         # required by Slack for the bot user; unused
settings:
  event_subscriptions:
    user_events:
      - message.channels
      - message.groups
      - message.im
      - message.mpim
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

## 2. Two tokens

1. **Basic Information → App-Level Tokens → Generate Token and Scopes**, name it
   `socket`, add scope `connections:write`. Copy the `xapp-…` token.
2. **OAuth & Permissions → Install to Workspace** (approve). Copy the
   **User OAuth Token** `xoxp-…` — not the bot token.

## 3. Add the connection in Huginn

**Connections → Add a connection → Slack**, paste both tokens, pick what channel
messages you want (below). The status turns **Running** once the socket is connected.
Everything except the tokens can be changed later with **Edit**.

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
  of, except the ones under *Ignore*. Until triage exists (roadmap step 2) all of it
  lands in the inbox, so expect volume.

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

## Known limits

- **No backfill yet.** Messages sent while Huginn was not running are not fetched
  afterwards; Socket Mode only delivers live events.
- **Threads you wrote in before connecting** are not known until you write in them again.
- The `message.channels` subscription delivers every message in every public channel you
  are in. Huginn filters them locally and stores only what is addressed to you, but the
  traffic still reaches it.
