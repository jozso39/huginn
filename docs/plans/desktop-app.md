# Plan: Huginn as a Mac app

Status: **proposed, 2026-10-06**. Owner decisions are marked ✅; open questions are in §11.

## 1. Goal and decisions

Huginn becomes **one product: a macOS app** that anyone can download, set up in minutes,
and run in the background on their own Mac. It replaces the Raspberry Pi deployment —
there will not be a server version and a desktop version side by side.

| Decision | |
|---|---|
| Tauri 2 shell + the existing Bun server as a compiled sidecar | ✅ |
| Distribute unsigned (no Apple Developer Program yet); `.dmg` on GitHub Releases | ✅ |
| Auto-update: check **hourly**, download in the background, install on restart | ✅ |
| Runs while the Mac is awake; catches up after sleep (Slack too — it now polls) | ✅ |
| Sharing of connection *setups* inside the company via an encrypted, password-protected file (stored in 1Password) | ✅ |
| Slack: one shared Huginn Slack app per company, each person signs in (option B) | ✅ |
| Signal: left out for now | ✅ |
| Triage: local Jev-like model inside the app; Jev via OpenRouter stays an option | proposed (§7) |
| Phone (PWA, Web Push) and the Pi deployment are retired | follows from "one version" — confirm (§11) |

Not goals now: Apple signing/notarisation ($99/yr — later, for wider company roll-out),
Windows/Linux, publishing the Slack app to the Slack Marketplace.

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

**Local triage model**
- Jev has no open weights; open "Jev clones" are too new and weak to rely on.
- Practical: a small multilingual LLM in **llama.cpp's `llama-server`** (a ~20 MB second
  sidecar), scoring each rule as P(yes) / (P(yes)+P(no)) from token probabilities.
  Candidate **Qwen3-1.7B** (Apache-2.0, 100+ languages incl. Czech, ~1.8 GB, public — no
  Hugging Face account needed); compare with Qwen3.5-2B and Gemma 4 E2B.
- Roughly 0.7–1 s per message on M1/M2 with one rule, +~0.1 s per extra rule (the
  message part of the prompt is cached). Needs ~1.5–2 GB RAM while loaded.
- Zero-shot NLI classifiers (DeBERTa/bge-m3) are weaker on long, compound rule sentences.
- Gated models (Meta Prompt Guard 2, Gemma) need a Hugging Face account and licence
  acceptance — only for optional extras.

## 3. Architecture

```
Huginn.app
├── Tauri shell (Rust)            window, tray + count, Dock badge, notifications,
│                                 launch at login, hourly updater, starts/stops sidecars
├── huginn-server (Bun, compiled) today's server: connectors, triage, SQLite, the SPA
│     └── talks to the shell over stdout JSON lines (ready / badge / notify)
└── llama-server (optional)       local judge model, started on demand (§7)

~/Library/Application Support/Huginn/   huginn.db, master.key (0600), models/
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
1. Server: 127.0.0.1 + launch token + Host/Origin checks; data dir + master key from
   the shell; embedded migrations and SPA; stdout events; exit on stdin close.
2. `desktop/` Tauri project: sidecar lifecycle, window with loading page, hide on close,
   tray (count; Open, Check for updates, Restart to update, Quit), Dock badge,
   notifications (best-effort), launch at login (on by default, switch in settings).
3. Updater: hourly check → background download → "Restart to update" in tray and a
   banner in the window; also checked at launch.
4. CI: on tag `v*` → matrix `macos-15` (arm64) + `macos-15-intel` → build web, compile
   sidecar per arch, `tauri-action` with updater key secrets → published Release with
   `.dmg`, `.app.tar.gz`, `.sig`, `latest.json`; `codesign -v` check.
5. **Migration from the Pi**: copy `huginn.db` and `HUGINN_SECRET_KEY` (as `master.key`)
   into Application Support. Gmail ×2, LinkedIn, GitLab, ClickUp keep working unchanged
   (refresh tokens don't depend on the redirect). Slack keeps its Socket Mode until M2.
   Signal stops (removed). Then stop the Pi container and timers.

### M2 — Sign in like a desktop app (≈ 1 week)
1. Google: Desktop OAuth client + loopback redirect + PKCE; drop Relay/Direct modes
   and `HUGINN_PUBLIC_URL`. Company project (Internal) and family project (External).
2. Slack: "Sign in with Slack" (PKCE, `localhost:<fixed port>`); token refresh
   (30-day refresh tokens); the Huginn Slack app manifest updated (user scopes only,
   PKCE on, never distributed).
3. Slack polling connector replacing Socket Mode (§6), keeping everything that exists:
   mrkdwn/attachments rendering, reply in thread, reactions, read-marker clearing,
   app links, closing when answered.
4. Short spike first (½ day, real token): does `to:me` work via the API, do group
   mentions search reliably, real request counts per minute.

### M3 — Sharing setups (≈ 3–4 days) — §5

### M4 — First run and clean-up (≈ 1 week) → first release to others
1. First-run wizard: welcome → **Import a shared setup** (or set up apps by hand) →
   sign in to accounts → triage engine (local model download / OpenRouter key / rules
   only) → launch at login.
2. User docs: install (Open Anyway), import, sign-ins; admin docs: creating the Google
   project and the Slack app for a company.
3. Remove what belongs to the Pi: Docker/compose, `deploy/`, Web Push + `push_devices`
   (migration), PWA manifest/service worker, relay page, Signal connector (tag the last
   Pi version `pi-final` so it can be restored), `HUGINN_*` env in favour of settings.
4. Release `v1.0.0`; give it to Jozef's wife (family Google project) and one colleague.

### M5 — Local triage model (≈ 1.5–2 weeks) — §7

Order rationale: M1–M4 make it shareable with hard rules (+ Jev for those with a key);
the local model is valuable but not a blocker for the first users.

## 5. Sharing setups (encrypted export / import)

**What is shared is a connection's *setup*, never someone's account.** A setup is what a
colleague needs to connect *their own* account: the sign-in app (Google OAuth client,
Slack app), non-personal settings (GitLab URL, ClickUp workspace, Gmail options) and,
optionally, its rules. Personal sign-ins (Gmail/Slack tokens, GitLab/ClickUp personal
tokens) and items are **never** exported — sharing them would give the recipient your
mailbox.

**Share** (Connections → Share):
1. A list of setups with checkboxes. Shareable: Google sign-in app (company/family),
   Slack app, GitLab (URL), ClickUp (workspace), Gmail/LinkedIn options, rules per
   connection, the OpenRouter key *only if it is a company key*. Not shareable (greyed,
   with the reason): anything that is only a personal token; Signal.
2. Ticking an item opens a panel **"If this file and its password leak"** with plain
   consequences, e.g.:
   - *Google sign-in app*: someone could show a "Huginn" sign-in page to your
     colleagues; they still read nobody's mail unless a person signs in to their copy.
     With an Internal app only medevio.cz accounts can be targeted. Fix: rotate the
     client secret in Google Cloud and re-share.
   - *Slack app*: the same, smaller — with PKCE there is no Slack secret in the file.
   - *OpenRouter key*: anyone can spend on that account. Set a spending limit; rotate.
   - *Rules*: reveal what you treat as spam/important. Harmless otherwise.
3. **Name** the file, with a suggestion: *"Huginn setup — Medevio — for <name>"* →
   `huginn-setup-medevio-<name>-2026-10-06.huginn`.
4. **Password**: either typed (min. 50 characters) or generated (64 random characters,
   shown **once** with Copy, never stored). Advice shown: keep file and password
   together in one 1Password item.

**File format** (`.huginn`, JSON): `{ format: "huginn-setup", version: 1, kdf: { alg:
"scrypt", N: 2^17, r: 8, p: 1, salt }, cipher: "aes-256-gcm", iv, ciphertext }`. Name,
recipient and contents are **inside** the ciphertext; the outside reveals nothing but
"a Huginn setup". scrypt is in Bun's `node:crypto`; with a ≥ 50-character password the
KDF is defence in depth, not the main protection.

**Import** (first-run wizard or Connections → Import): pick the file → password →
preview (*"Google sign-in app (medevio.cz), Slack app (Medevio), GitLab
gitlab.medevio.dev, 12 rules"*) → confirm → the apps are stored (sealed with the local
master key) → the person signs in to each account. Importing again updates, never
duplicates.

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

## 7. Local triage model

- A `Judge` port with two adapters: **LocalJudge** (`llama-server` sidecar) and
  **JevJudge** (today's OpenRouter client). Settings: *Triage engine: Local / Jev /
  Rules only*. Hard rules work in every mode.
- Model downloaded on first use from Hugging Face (public repos, ~1.8 GB) into
  `Application Support/Huginn/models`, with a checksum; the sidecar starts on demand and
  stops after ~10 min idle to give the RAM back.
- Prompt: message first (cached), then the rule; answer tokens in English; message text
  fenced as data. Probability = P(yes)/(P(yes)+P(no)).
- **Calibration harness** (`bun run eval:judge`): Jozef's database holds Jev's
  probabilities for real items and his own corrections → compare the local model with Jev
  per rule; fit a temperature / per-rule threshold; report agreement before switching.
- Injection guard: the same local model answers the existing guard question; Prompt
  Guard 2 (gated, needs the Hugging Face account) as an optional later add-on.
- The rule-writing agent stays on OpenRouter (Haiku) when a key exists; without one, a
  reason is stored and the user writes the rule (with a "Rule from this message" helper
  that pre-fills the editor). A local rule writer is out of scope.

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
| Local model weaker than Jev in Czech | Calibration harness gates the switch; Jev stays available |
| Laptop holds everyone's tokens | Sealed with the master key; FileVault; 127.0.0.1 + launch token; Keychain later |

## 10. Effort

M1 ≈ 1 week · M2 ≈ 1 week · M3 ≈ 3–4 days · M4 ≈ 1 week → **first release to others in
≈ 4 weeks**; M5 ≈ 1.5–2 weeks after.

## 11. Open questions for Jozef

1. **Company Google project**: can you create a Google Cloud project *inside the
   medevio.cz organisation* (consent screen Internal), or who is the Workspace admin?
2. **Slack**: you create the "Huginn" app in the Medevio workspace from the manifest;
   does the workspace require admin approval for apps?
3. **Retire the Pi and the phone** (PWA, Web Push) after M1 — confirm.
4. **Intel Macs**: build them too (free; doubles CI time) — anyone at Medevio on Intel?
5. **Moving to a new Mac**: also offer a personal "full backup" export (accounts
   included, for yourself only), or is copying the data folder enough?
