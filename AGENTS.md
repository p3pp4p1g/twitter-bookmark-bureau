# AGENTS.md

This repository is intended to be safe for public open-source use.

## Mission

Maintain a private-first bookmark manager for X/Twitter that:

- avoids the paid official X API
- keeps secrets server-side or local-only
- supports a one-time local bootstrap
- runs the normal daily incremental sync on Cloudflare

## Operating Model

- **Bootstrap / recovery**: local Linux or any bash-compatible local environment
- **Daily production sync**: Cloudflare Worker scheduled job
- **Persistence**: D1 for metadata, R2 for mirrored media and raw snapshots
- **Classification**: Gemini server-side only
- **Notifications**: Telegram from the Worker

## Non-negotiable Safety Rules

- Never commit secrets, cookies, API keys, tokens, account ids, chat ids, or local paths containing personal data.
- Never commit `.env.local`, `.dev.vars`, `manual_export/`, `.agent-state/`, or temporary deployment configs.
- Keep `wrangler.toml` generic in git. Real account and resource identifiers must stay outside tracked files.
- Do not hardcode personal deployment URLs, email addresses, usernames, hostnames, or chat identifiers.
- Do not add sample data derived from a real bookmark archive.

## Privacy Expectations

- Treat bookmark content, media, exports, and recovered metadata as private user data.
- Use placeholders in docs and examples.
- If a new script needs secrets, document the variable names only, not example real values.

## Architecture Expectations

- The README is the source of truth for the recommended user workflow.
- The recommended workflow is:
  - local bootstrap once
  - Cloudflare-only daily sync afterward
- WSL is not a required platform and should not be described as part of the production architecture.

## Documentation Rules

- Keep README aligned with the actual runtime split between local bootstrap/recovery and Cloudflare daily sync.
- Prefer generic wording such as `local Linux environment` or `bash-compatible local environment`.
- When documenting Cloudflare endpoints, use placeholders like `https://<your-worker>.workers.dev`.

## Security / OSS Readiness Checklist

Before any public release or major merge:

- verify tracked files do not include secrets or personal references
- verify ignored local files remain untracked
- verify examples use placeholders only
- verify GitHub workflows and security docs still match the repo
- verify no commit introduces real deployment identifiers

## Implementation Guidance

- Prefer small, auditable changes over broad refactors.
- Preserve the private-first model.
- If a feature increases secret exposure risk, choose the safer design even if it is less convenient.
