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
- optional fallback scheduled sync

Main files:

- `src/worker/index.ts`
- `src/worker/db.ts`
- `src/worker/gemini.ts`
- `src/worker/twitter-sync.ts`

### 2. Local / WSL Agent

Owns the operational sync work:

- initial backfill from manual export
- daily sync against X using a valid browser session
- media reconciliation and upload to the Worker
- Telegram notifications

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
3. Run `npm run agent:backfill`
4. The agent imports only missing bookmarks
5. The agent mirrors missing media
6. The Worker classifies bookmarks with Gemini

### Daily / Phase 2

1. The WSL agent runs at `03:00`
2. It reads recent bookmarks from X using the web session cookies
3. It stops when it reaches already-known pages
4. It imports only new bookmarks
5. It mirrors missing media
6. It sends Telegram notifications only on relevant state changes

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
  - shared secret for the local agent to call admin endpoints
- `GEMINI_API_KEY`
  - used for categorization
- `SITE_PSK`
  - shared key for accessing the UI
- `SESSION_SECRET`
  - signs the app session cookie
- `X_API_KEY`
  - optional
  - lets the Worker itself perform fallback bookmark sync
  - format: raw cookie bundle or base64-encoded cookie bundle containing `auth_token` and `ct0`

### Local / WSL agent

- `BOOKMARK_BUREAU_BASE_URL`
- `INGEST_API_KEY`
- `TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_API`
- `TELEGRAM_CHAT_ID`
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

Run once manually:

```bash
npm run agent:daily
```

Run historical backfill once:

```bash
npm run agent:history
```

Run media backlog reconciliation only:

```bash
npm run agent:media
```

Install the WSL cron:

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
