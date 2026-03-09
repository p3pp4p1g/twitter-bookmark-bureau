# Security Policy

## Supported Scope

This project is maintained as a hobby-grade private-first archive tool.

Security-sensitive areas include:

- authentication and session handling
- admin endpoints
- X session cookie handling
- Cloudflare secret usage
- media mirroring and file serving
- GitHub workflow and release hygiene

## Reporting a Vulnerability

Do not open public issues for security problems.

Instead:

- prepare a minimal report with impact, affected area, and reproduction steps
- avoid including real secrets, tokens, cookies, or private bookmark content
- share the report privately with the repository maintainer through a non-public channel

## Disclosure Expectations

- avoid publishing exploit details before a fix is available
- rotate any affected secrets immediately if exposure is suspected
- assume local exports and session cookies are sensitive at all times

## Hard Rules for Contributors

- never commit secrets or personal deployment identifiers
- never add real user bookmark data as fixtures
- use placeholders in docs, examples, and tests
