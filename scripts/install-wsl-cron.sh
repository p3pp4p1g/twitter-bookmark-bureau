#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_DIR/.agent-state/logs"
mkdir -p "$LOG_DIR"

CRON_LINE="0 3 * * * cd $REPO_DIR && /usr/bin/env bash -lc 'npm run agent:daily >> \"$LOG_DIR/daily-sync.log\" 2>&1'"

TMP_FILE="$(mktemp)"
crontab -l 2>/dev/null | grep -v "npm run agent:daily" > "$TMP_FILE" || true
echo "$CRON_LINE" >> "$TMP_FILE"
crontab "$TMP_FILE"
rm -f "$TMP_FILE"

echo "Installed daily Bookmark Bureau agent cron at 03:00 local time."
