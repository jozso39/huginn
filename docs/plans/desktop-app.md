# Plan: Huginn as a Mac app

Status: **agreed 2026-10-06** (decisions ✅ are Jozef's). Work starts with M1.

## 1. Goal and decisions

Huginn becomes **one product: a macOS app** that anyone can download, set up in minutes,
and run in the background on their own Mac. The Raspberry Pi deployment and the phone
version (PWA, Web Push) are **retired** — there is no server version beside it.

| Decision | |
|---|---|
| Tauri 2 shell + the existing Bun server (Bun ≥ 1.4.1) as a compiled sidecar | ✅ |
| Distribute unsigned (no Apple Developer Program yet); `.dmg` on GitHub Releases | ✅ |
| Auto-update: check **hourly**, download in the background, install on restart | ✅ |
| Runs while the Mac is awake; catches up after sleep (Slack too — it now polls) | ✅ |
| **No sharing of setups.** Instead every connection type gets a **setup guide** in the app (like Make's / n8n's credential docs); sign-in app secrets are typed in by whoever sets up that Mac | ✅ |
| Slack: one Huginn Slack app per company, never distributed; each person signs in (option B) | ✅ |
| Triage: on first launch the user may enter an **OpenRouter** or a **TypeSafe** API key (explained there); without one, condition rules only. **No local model** (no 2 GB download) | ✅ |
| **Full backup export** (encrypted, password) to move to a new Mac | ✅ |
| Signal: not shipped; offered where signal-cli is installed (`brew install signal-cli`), which Jozef uses (2026-10-06) | ✅ |
| Retire the Pi and the iPhone version after M1 | ✅ |
| Notifications: build them, Jozef tries them for a few days before deciding on more | ✅ |

Not goals now: Apple signing/notarisation ($99/yr — later, for wider company roll-out),
Windows/Linux, publishing the Slack app, a local triage model. See §10 *Later*.

## 2. What the research settled (2026-10-06)

**Tauri / macOS (unsigned)**
- Sidecar: `bundle.externalBin`, per-arch file names (`-aarch64-apple-darwin`,
  `-x86_64-apple-darwin`); Rust spawns it, reads stdout lines, kills it on exit.
- Needs **Bun ≥ 1.4.1** (earlier compiled binaries fail signing / are killed by macOS),
  `"signingIdentity": "-"` (ad-hoc; without it a download says *"damaged"*), and
  `hardenedRuntime: false` (Bun's JIT needs entitlements otherwise; nothing is lost
  without notarisation). CI runs `codesign -v` on the result.
- First launch of a downloaded unsigned app: **System Settings → Privacy & Security →
  Open Anyway** (right-click → Open no longer works since macOS 15). One time per install.
- Updater (`tauri-plugin-updater`) has its own signing key (minisign, free), reads
  `latest.json` from the latest GitHub Release (tauri-action generates it). Updates it
  downloads carry no quarantine flag, so they open without Gatekeeper prompts. No
  built-in schedule → a Rust loop checks hourly.
- Tray text (`set_title`) shows the Important count; Dock badge; hide-on-close;
  launch at login via a LaunchAgent (`tauri-plugin-autostart`).
- **Notifications are a risk** without a stable signature (the official plugin uses a
  deprecated API; reports of banners never showing). Treat as best-effort, with a
  direct `UNUserNotificationCenter` call as the fix to try; tray count + Dock badge
  are the reliable signal.
- **Keychain is impractical unsigned** (prompts after every update, the code hash
  changes). The master key goes to a `0600` file in Application Support behind a
  `SecretStore` port; Keychain once there is a Developer ID.
- GitHub Actions macOS runners are **free for public repos**; release files ≤ 2 GiB.

**Google**
- "Desktop app" OAuth client: redirect to `http://127.0.0.1:<any port>`, PKCE; Google
  treats its secret as non-confidential. No relay page needed any more.
- **Company:** a Google Cloud project owned by the medevio.cz organisation with the
  consent screen **Internal** → no verification, no warning screen, no user cap. If the
  Workspace admin restricts Gmail under API Controls, they must tick *Trust internal apps*.
- **Family / gmail.com:** an External project in production, unverified → a one-time
  "Google hasn't verified this app" screen, a lifetime cap of 100 users, refresh tokens
  do not expire (they do after 7 days only in *Testing*). Personal Gmail accounts cannot
  use the company's Internal project.

**Slack (option B)**
- One Slack app per company workspace, **never "distributed"** (keeps it an internal app,
  exempt from the 2025 limits of 1 request/min on history for non-Marketplace apps).
  An admin approves it once if the workspace requires approval; everyone signs in.
- Sign-in from the desktop with **PKCE** (GA since 2026-03-30): no client secret,
  redirect `http://localhost:<fixed port>/…` (exact port match, `localhost` not
  `127.0.0.1`). PKCE apps get rotating tokens: a refresh token lasts 30 days, so a Mac
  off for a month means signing in again.
- **Socket Mode cannot be shared** (one app token gets everyone's events) → each Huginn
  **polls** with the person's own user token.
- Rate limits are **per method, per app, per workspace**: every colleague draws from the
  same pool (search ≈ 20/min, history/replies/info ≈ 50/min). Fine for ~10 people at a
  minute; beyond that the interval stretches automatically (§6).

**Local triage model (researched, not pursued)**
- Jev has no open weights; the usable local substitute is a ~1.8 GB LLM (Qwen3-1.7B in
  llama.cpp). Rejected for size. Triage uses Jev through the user's own key instead.

## 3. Architecture

```
Huginn.app
├── Tauri shell (Rust)            window, tray + count, Dock badge, notifications,
│                                 launch at login, hourly updater, starts/stops sidecars
└── huginn-server (Bun, compiled) today's server: connectors, triage, SQLite, the SPA
      └── talks to the shell over stdout JSON lines (ready / badge / notify)

~/Library/Application Support/Huginn/   huginn.db, master.key (0600)
```

- **The window loads `http://127.0.0.1:<port>`** from the sidecar — the SPA stays as it
  is, one origin for API, cookies and OAuth callbacks. A bundled "Starting…" page shows
  until the sidecar prints `READY`.
- **Local API protection** (new; on a laptop any website could otherwise POST to the
  port): bind to `127.0.0.1` only (today `0.0.0.0`); a per-launch random token the
  window presents once and gets back as an `HttpOnly; SameSite=Strict` cookie; every
  `/api` call requires it; `Host` must be `127.0.0.1:<port>`/`localhost:<port>` (DNS
  rebinding); state-changing requests must carry a matching `Origin`. OAuth callback
  routes check their one-time `state` instead. `bun run dev` keeps working with a
  dev-mode switch.
- **Port**: fixed default (e.g. 47823) because Slack needs an exact redirect; two
  fallback ports registered in the Slack app; Google accepts any port.
- **Master key**: generated by the shell on first launch into `master.key`, handed to
  the sidecar on stdin (never in env or argv). Behind a `SecretStore` port so Keychain
  can replace it later.
- **Server changes for packaging**: embed migrations and `web/dist` in the compiled
  binary (`--asset` or text imports — today the binary fails with *Can't find
  meta/_journal.json*); production logging without `pino-pretty`; data dir from an
  argument; exit when stdin closes (no orphan if the shell crashes).
- **Shell ↔ server events** (stdout JSON lines): `ready {port}`, `badge {important}`,
  `notify {title, body, itemId}`. Clicking a notification focuses the window on the item.
  The SPA needs no Tauri code.

## 4. Milestones

Each milestone ends with something Jozef uses daily.

### M1 — The Mac app (≈ 1 week)
1. Bun 1.4.1. Server: 127.0.0.1 + launch token + Host/Origin checks; data dir and master
   key from the shell; embedded migrations and SPA; production logging; stdout events;
   exit on stdin close.
2. `desktop/` Tauri project: sidecar lifecycle, window with loading page, hide on close,
   tray (count; Open, Check for updates, Restart to update, Quit), Dock badge,
   notifications, launch at login (on by default, switch in settings).
3. Updater: hourly check → background download → "Restart to update" in tray and a
   banner in the window; also checked at launch.
4. CI: on tag `v*` → `macos-15` (Apple Silicon) → build web, compile sidecar,
   `tauri-action` with updater key secrets → published Release with `.dmg`,
   `.app.tar.gz`, `.sig`, `latest.json`; `codesign -v` check. (Intel: §10.)
5. **Migration from the Pi**: copy `huginn.db` and `HUGINN_SECRET_KEY` (as `master.key`)
   into Application Support. Gmail ×2, LinkedIn, GitLab, ClickUp keep working unchanged
   (refresh tokens don't depend on the redirect). Slack keeps its Socket Mode until M2.
   Then stop the Pi container, timers and signal-cli service.

### M2 — Sign in like a desktop app (≈ 1 week)
1. Google: Desktop OAuth client + loopback redirect + PKCE; drop Relay/Direct modes
   and `HUGINN_PUBLIC_URL`. Company project inside medevio.cz (Internal) — Jozef creates
   it; family: his personal project (External).
2. Slack: "Sign in with Slack" (PKCE, `localhost:<fixed port>`); token refresh
   (30-day refresh tokens); the Huginn Slack app manifest updated (user scopes only,
   PKCE on, never distributed). Jozef approves it in Medevio (he is admin).
3. Slack polling connector replacing Socket Mode (§6), keeping everything that exists:
   mrkdwn/attachments rendering, reply in thread, reactions, read-marker clearing,
   app links, closing when answered.
4. Short spike first (½ day, real token): does `to:me` work via the API, do group
   mentions search reliably, real request counts per minute.

### M3 — First run, guides, triage keys, backup (≈ 1 week) — §5, §7
1. First-run wizard: welcome → triage key (OpenRouter / TypeSafe / skip) → add
   connections (each with its guide) → launch at login.
2. Setup guides for Gmail (Google Cloud project + Desktop client), Slack (signing in;
   creating the company app is an admin guide), GitLab, ClickUp, LinkedIn.
3. Full backup export / restore.

### M4 — Clean-up and first release (≈ 3–4 days)
1. Remove what belongs to the Pi and the phone: Docker/compose, `deploy/`, Web Push +
   `push_devices` (migration), PWA manifest/service worker, relay page, Ingest key env
   (tag the last Pi version `pi-final` so it can be restored). The Signal connector stays:
   since 2026-10-06 it runs signal-cli itself (docs/signal.md).
2. User docs: install (Open Anyway), first run; admin docs: the company Google project
   and Slack app.
3. Release `v1.0.0`; install for Jozef's wife and one colleague.

## 5. Setup guides and full backup

**Setup guides** (replace sharing). Every connection type has a step-by-step guide shown
next to its form when adding it, written like Make's / n8n's credential pages: what you
need, where to click (with the exact menu names and links), what to paste where, what
each permission is for, and how to check it worked. Content lives in Markdown in the repo
(`docs/guides/<kind>.md`) and is rendered in the app, so it is also readable on GitHub.
- *Gmail / LinkedIn*: create a Google Cloud project, enable the Gmail API, consent
  screen (Internal for a company, External + test users or production for personal),
  create a **Desktop** OAuth client, paste ID + secret into Huginn once, then sign in.
- *Slack*: for users — sign in with the company's Huginn app (the client ID comes from
  whoever set it up; with PKCE it is not a secret). For the admin — create the app from
  the manifest, approve it, never distribute it.
- *GitLab*: personal access token, legacy, scope `api` (why only that one).
- *ClickUp*: personal API token, workspace ID when several.
- *Triage keys*: what OpenRouter / TypeSafe are, what Huginn sends them, cost, spending
  limits.

**Full backup** (Settings → Backup). Moves *everything* — accounts included — to a new
Mac, so it is protected like a password vault:
1. Export: a consistent snapshot of the database (SQLite online backup) plus the master
   key, encrypted into one `.huginn-backup` file.
2. Password: typed (min. 50 characters) or generated (64 random characters, shown
   **once** with Copy, never stored). Advice: keep file and password together in one
   1Password item. A warning says plainly that file + password = access to every
   connected account.
3. Format: `{ format: "huginn-backup", version: 1, kdf: { alg: "scrypt", N: 2^17, r: 8,
   p: 1, salt }, cipher: "aes-256-gcm", iv, ciphertext }`; scrypt and AES-GCM from Bun's
   `node:crypto`. Nothing readable outside the ciphertext.
4. Restore: on first run ("Restore from backup") or in Settings (replaces local data after
   a confirmation). Connections restart with the restored tokens.

## 6. Slack polling (option B)

Per person, every *Check every* interval (default 1 min; stretches on `429`):
1. `search.messages` for new mentions of me since the last check (`<@me>`, plus my user
   groups in rotation) and for DMs/group DMs to me (`to:me`, verified in the M2 spike).
2. Threads I'm in: a watch list built from my own thread replies; `conversations.replies`
   with `oldest=` for threads active in the last few days, backing off as they go quiet.
3. Read markers (`conversations.info`) when *Read in Slack → Clear* is on; my own
   messages found by the same queries close conversations as today.
4. De-duplicate by channel + ts, add jitter, honour `Retry-After`; a status line on the
   connection when the shared pool is busy.

Catch-up after sleep is natural: the next check searches since the last one.

## 7. Triage keys (OpenRouter or TypeSafe)

- First run (and Settings → Triage) explains in two sentences what the key is for:
  *sentence rules* ("an automated notification, not a person") and learning from Spam /
  Important reasons need a model; without a key Huginn sorts with condition rules only.
- **OpenRouter key**: Jev for sentence rules and guardrails + the rule-writing agent
  (Haiku). Today's setup.
- **TypeSafe key**: Jev directly from TypeSafe for sentence rules and guardrails. The
  rule-writing agent needs a chat model, so with only a TypeSafe key a Spam / Important
  reason is stored and the user writes the rule themselves (helped by a "Rule from this
  message" pre-fill). Needs a short check of TypeSafe's direct API (endpoint, auth,
  model id, response shape) — M3.
- Keys are sealed with the master key like every other secret; a "Test key" button
  makes one cheap call.

## 8. What stays the same

Hexagonal layout and rules (CLAUDE.md), connectors' contracts, triage rules and
history, rendering (Slack mrkdwn, e-mail sandbox), the dashboard. Development still runs
with `bun run dev` in a browser; the desktop shell is a thin layer around it.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Notifications don't appear (unsigned) | Tray count + Dock badge; direct UNUserNotificationCenter call; Developer ID later |
| Slack shared rate pool with many users | Adaptive interval; search-first design; measure in the M2 spike |
| Slack `to:me`/group search not reliable via API | Spike before building; fallback: `users.conversations` + `conversations.info` unread counts for DMs |
| Gatekeeper friction for non-technical users | One illustrated step in the install guide; Developer ID when rolling out wider |
| Company Workspace policy blocks the Internal Google app | Admin ticks *Trust internal apps*; confirm early (§11) |
| Laptop holds everyone's tokens | Sealed with the master key; FileVault; 127.0.0.1 + launch token; Keychain later |

## 10. Effort and later

M1 ≈ 1 week · M2 ≈ 1 week · M3 ≈ 1 week · M4 ≈ 3–4 days → **first release to others in
≈ 3½–4 weeks.**

**Later (not planned yet):**
- Make the Slack app manifest gettable outside the repo (a URL / copy button in the
  admin guide) — Jozef's request, 2026-10-06.
- Apple Developer ID: notarised app, Keychain for the master key, reliable notifications.
- Intel Mac builds (one more CI runner, free) — when someone needs them.
- Publishing the Slack app (Marketplace) for use outside Medevio.
- Signal for everyone: bundle signal-cli (Homebrew's native build, ~120 MB, GPL-3.0 —
  shipped as a separate program next to the server) instead of asking for Homebrew.
- A local triage model if a small (≪ 1 GB) one becomes good enough.

## 11. Answers (2026-10-06)

1. Company Google project inside medevio.cz: Jozef can create it.
2. Slack app approval in Medevio: required, Jozef has the rights.
3. Retire the Pi and the iPhone version: yes.
4. Full backup export: yes.
5. Intel builds: not answered — Apple Silicon only for now (§10).
