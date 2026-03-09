#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-dry-run}"

TARGETS=(
  "$ROOT_DIR/manual_export"
  "$ROOT_DIR/.agent-state"
)

find_media() {
  find "${TARGETS[@]}" \
    -type f \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.mp4' -o -iname '*.mov' \) \
    2>/dev/null
}

FILES="$(find_media || true)"

if [[ -z "$FILES" ]]; then
  echo "No local media files found."
  exit 0
fi

if [[ "$MODE" != "--apply" ]]; then
  echo "Dry run. Media files that would be deleted:"
  printf '%s\n' "$FILES"
  echo
  echo "Run with --apply to delete them."
  exit 0
fi

printf '%s\n' "$FILES" | while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  rm -f "$file"
done

echo "Local media files deleted."
