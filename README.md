# Twitter Bookmark Bureau

Private-first bookmark manager for X/Twitter without the paid official API.

It ingests bookmarks using a logged-in X web session, mirrors media to Cloudflare R2, classifies bookmarks with Gemini, and serves a protected UI from a Cloudflare Worker.

## What It Does

- imports bookmarks from a manual export or from the X web client session
- deduplicates by bookmark/tweet id
- mirrors media to R2
- categorizes bookmarks with Gemini
- supports manual category override
- serves a protected web UI with search, filters, infinite scroll, and inline media previews
- sends operational notifications to Telegram on meaningful state changes

## Recommended Procedure

The recommended operating model is:

1. **Bootstrap locally once**
2. **Run daily incremental sync on Cloudflare**

Why:

- the initial import and historical recovery are the heaviest and least predictable operations
- the daily delta is small and fits the Cloudflare Worker free tier much better
- production no longer depends on leaving a personal machine turned on
- local tooling stays useful for exceptional recovery without being part of the normal daily loop

## Architecture

This project is intentionally split into two runtimes.

### 1. Cloudflare Worker

Owns the product surface:

- React UI
- API
- D1 database
- R2 media + raw snapshot storage
- Gemini categorization
- server-side access gate with PSK
- daily scheduled sync
- media mirroring for the daily delta plus limited historical backlog draining
- Telegram notifications for operational state changes

Main files:

- `src/worker/index.ts`
- `src/worker/db.ts`
- `src/worker/gemini.ts`
- `src/worker/twitter-sync.ts`

### 2. Local Bootstrap / Recovery Tooling

Used only for heavy or exceptional operations:

- initial backfill from manual export
- historical recovery when the export missed older bookmarks
- one-off media reconciliation or repair
- manual recovery flows when X changes behavior

Main files:

- `src/agent/backfill.ts`
- `src/agent/daily-sync.ts`
- `src/agent/media.ts`
- `src/agent/twitter.ts`

## Why This Exists

The goal is a hobby-grade but practical archive for bookmarks, without:

- the paid official X API
- giving X credentials to a third-party SaaS
- exposing the archive publicly

The design biases are:

- accuracy over speed
- no duplication
- resumable sync
- secrets kept server-side or local-only

## Inspirations

This repo is original code, but these projects informed the approach:

- [`twitter-web-exporter`](https://github.com/prinsss/twitter-web-exporter)
  - inspiration for the bootstrap path via manual export
  - good fallback when X changes internal endpoints
- [`Siftly`](https://github.com/viperrcrypto/Siftly)
  - inspiration for authenticated bookmark sync with `auth_token` + `ct0`
  - useful precedent for incremental bookmark retrieval without the official API
- [`birdclaw`](https://github.com/steipete/birdclaw)
  - inspiration for a local-first operational model and session-oriented tooling
- [`Rettiwt-API`](https://github.com/Rishikant181/Rettiwt-API)
  - explored early as a reference for unofficial X access patterns

## Techniques Used

- unofficial X web GraphQL endpoint access
- browser session reuse via `auth_token` + `ct0`
- manual export fallback import
- normalization into a stable bookmark schema
- D1 for metadata, state, alerts, overrides, and sync bookkeeping
- R2 for mirrored media and raw snapshots
- Gemini for categorization and classification reasoning
- Telegram bot notifications on state transitions
- Cloudflare Worker for protected UI and API

## Data Flow

### Bootstrap / Phase 1

1. Export bookmarks with `twitter-web-exporter`
2. Put the export file in `manual_export/`
3. Run `npm run agent:backfill` from a local Linux environment, or any other bash-compatible local setup
4. The local tooling imports only missing bookmarks
5. The local tooling mirrors missing media
6. The Worker stores the archive in D1/R2 and classifies bookmarks with Gemini

### Daily / Phase 2

1. The Cloudflare Worker runs at `03:00` BRT
2. It reads recent bookmarks from X using the persisted `X_API_KEY` session cookie bundle
3. It stops when it reaches already-known pages
4. It imports only new bookmarks
5. It classifies the new bookmarks and retries any older uncategorized backlog still left in D1
6. It mirrors the new media for that daily delta and drains a small historical media backlog batch
7. It sends Telegram notifications only on relevant state changes

### Historical Recovery / Phase 3

When a manual export missed older bookmarks, use the historical backfill flow.

It:

- walks the X bookmark timeline past already-known pages
- imports only missing older bookmarks
- falls back to smaller chunks and single-item import when the Worker returns transient `500`
- can import a single problematic bookmark without immediate classification, then classify it later
- reconciles missing media after each pass
- supports repeated passes until the archive stabilizes

## Security Model

- no X username/password is stored
- only the X web session cookies are used
- Gemini key stays server-side
- Cloudflare secrets stay server-side
- the UI is protected by server-side PSK
- admin endpoints require `INGEST_API_KEY`
- `manual_export/` and `.agent-state/` are ignored from git

## Required Secrets

There are two classes of secrets: runtime secrets and provisioning/deploy secrets.

### Cloudflare / Worker runtime

- `INGEST_API_KEY`
  - shared secret for local bootstrap/recovery tooling to call admin endpoints
- `GEMINI_API_KEY`
  - used for categorization
- `SITE_PSK`
  - shared key for accessing the UI
- `SESSION_SECRET`
  - signs the app session cookie
- `X_API_KEY`
  - required for Worker-side daily bookmark sync
  - format: raw cookie bundle or base64-encoded cookie bundle containing `auth_token` and `ct0`
- `TELEGRAM_BOT_API`
  - used by the Worker for operational notifications
- `TELEGRAM_CHAT_ID`
  - target chat for Worker notifications

### Local bootstrap / recovery tooling

- `BOOKMARK_BUREAU_BASE_URL`
- `INGEST_API_KEY`
- one of:
  - `X_API_KEY`
  - or `AUTH_TWITTER_TOKEN` + `CT0_TWITTER`

### Provisioning / deploy

- `CLOUDFLARE_API_TOKEN`
  - used by `wrangler` and the provisioning script

## Environment Files

Safe examples live in:

- `.env.local.example`
- `.dev.vars.example`

Do not commit:

- `.env.local`
- `.dev.vars`
- `manual_export/`
- `.agent-state/`

## X Session Format

The sync does not use the paid official X API.

Instead, it uses a valid logged-in X web session, represented as:

```text
auth_token=...; ct0=...;
```

You can provide that in either form:

### Option A

`X_API_KEY` as raw cookie bundle or base64-encoded cookie bundle.

### Option B

Split cookies:

```env
AUTH_TWITTER_TOKEN=...
CT0_TWITTER=...
```

The agent will build the cookie bundle automatically.

## Setup

Install dependencies:

```bash
npm install
```

Run validation:

```bash
npm run typecheck
npm test
npm run build
```

For local bootstrap and recovery commands, assume a normal local Linux setup with `bash` and Node.js.
WSL also works, but it is not required and is not part of the recommended production architecture.

## Cloudflare Provisioning

1. Fill `.env.local`
2. Edit `wrangler.toml` placeholders or let the provisioning script patch them
3. Run:

```bash
npm run cf:provision
```

Then deploy:

```bash
npm run cf:deploy
```

The provisioning script creates or updates:

- D1 database
- R2 bucket
- Worker secrets when present in the environment

## Database Migrations

Local:

```bash
npm run db:migrate:local
```

Remote:

```bash
npm run db:migrate:remote
```

## Backfill

Place the export file in `manual_export/`, then run:

```bash
npm run agent:backfill
```

What happens:

- reads JSON or CSV export
- normalizes bookmarks
- imports only missing items
- mirrors missing media
- triggers categorization
- sends concise Telegram updates

## Daily Sync

The normal daily sync runs on the Cloudflare Worker cron at `03:00` BRT.

You can also trigger the same Worker-side daily pipeline manually:

```bash
curl -X POST \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  https://<your-worker>.workers.dev/api/admin/sync/daily
```

## Local Recovery Commands

These are for bootstrap, repair, or exceptional recovery. They are not the recommended daily production loop.

Run historical backfill once:

```bash
npm run agent:history
```

Run media backlog reconciliation only for faster catch-up or one-off repair:

```bash
npm run agent:media
```

Legacy local cron helper:

```bash
npm run agent:cron:install
```

Run the historical loop until stabilization:

```bash
bash scripts/run-history-until-stable.sh
```

## Admin Endpoints

All admin endpoints require `INGEST_API_KEY`.

- `GET /api/admin/bookmarks/export`
- `GET /api/admin/ops/status`
- `POST /api/admin/sync/push`
- `POST /api/admin/media/upload`
- `POST /api/admin/alerts`
- `POST /api/admin/sync`
- `POST /api/admin/sync/daily`

## Status And Monitoring

The app now exposes two monitoring surfaces:

- `GET /api/status`
  - protected by the normal site session
  - returns the detailed internal status snapshot used by the UI status board
  - includes sync freshness, import consistency, unsorted backlog, media backlog, and active alerts
- `GET /api/healthz`
  - public and intentionally minimal
  - returns `200` when the service is healthy or degraded
  - returns `503` when the health checks detect a failing state
  - safe for external uptime monitors because it does not expose bookmark content

Recommended monitoring setup:

1. Use Telegram notifications from the Worker for state changes that happen during a sync run.
2. Add an external monitor such as Better Stack, UptimeRobot, or a lightweight GitHub Actions job to poll `https://<your-worker>.workers.dev/api/healthz`.
3. Alert when `/api/healthz` returns `503` or when the monitor itself stops receiving a successful heartbeat on schedule.

Why both:

- Telegram covers in-band runtime failures when the Worker actually executes.
- an external monitor covers dead-man-switch scenarios such as cron not firing, deployment regressions, or the Worker becoming unreachable.

## Telegram Notifications

The bot is intentionally quiet.

It only sends messages when something relevant changes, such as:

- sync started
- sync finished
- backfill started
- backfill finished
- X session invalid
- X endpoint changed or failed
- sync recovered
- media backlog milestone reached during initial backfill

## Resilience Notes

The current sync flow includes a few pragmatic safeguards:

- retries for transient X endpoint failures such as `Timeout` and `Dependency: Unspecified`
- historical backfill that keeps going even when already-known pages appear first
- recursive chunk splitting when the Worker fails on a big import batch
- single-item fallback import without immediate classification for pathological cases
- separate pending-classification pass
- separate media-only reconciliation pass
- background runner to repeat historical passes until the archive stabilizes
- daily sync living fully in Cloudflare so normal operation does not depend on a local machine

## Frontend

The UI includes:

- server-side gated access
- infinite vertical scroll
- inline image previews
- bookmark text truncation with inline expand
- search and category filters
- manual category override

## OSS Notes

This repo is safe to publish only if you keep local/private data out of git.

Before pushing:

- make sure `.env.local` is not tracked
- make sure `manual_export/` is not tracked
- make sure `.agent-state/` is not tracked
- do not commit Cloudflare account ids, database ids, or personal deployment URLs

`wrangler.toml` in this repo is intentionally generic and must be filled for a real deployment.
