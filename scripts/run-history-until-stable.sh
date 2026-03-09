#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.agent-state/logs"
mkdir -p "$LOG_DIR"

MAX_RUNS="${HISTORY_MAX_RUNS:-20}"
STABLE_TARGET="${HISTORY_STABLE_RUNS:-2}"
stable_runs=0

fetch_state() {
  cd "$ROOT_DIR"
  node --input-type=module <<'EOF'
import { config as load } from "dotenv";
load({ quiet: true });
load({ path: ".env.local", override: true, quiet: true });

const base = process.env.BOOKMARK_BUREAU_BASE_URL;
const auth = { authorization: `Bearer ${process.env.INGEST_API_KEY}` };
const head = await fetch(`${base}/api/admin/bookmarks/export?limit=1&offset=0`, {
  headers: auth,
});
if (!head.ok) {
  throw new Error(`${head.status} ${await head.text()}`);
}

const headPage = await head.json();
const total = Number(headPage.total ?? 0);
let oldest = null;
let oldestId = null;

if (total > 0) {
  const tail = await fetch(`${base}/api/admin/bookmarks/export?limit=1&offset=${Math.max(total - 1, 0)}`, {
    headers: auth,
  });
  if (!tail.ok) {
    throw new Error(`${tail.status} ${await tail.text()}`);
  }
  const tailPage = await tail.json();
  oldest = tailPage.items?.[0]?.createdAt ?? null;
  oldestId = tailPage.items?.[0]?.id ?? null;
}

const ops = await fetch(`${base}/api/admin/ops/status`, { headers: auth }).then((r) => r.json());

console.log(
  JSON.stringify({
    total,
    oldest,
    oldestId,
    mediaMissing: ops.media.bookmarksMissingMedia,
  }),
);
EOF
}

for run in $(seq 1 "$MAX_RUNS"); do
  before="$(fetch_state)"
  echo "history-run $run before=$before" | tee -a "$LOG_DIR/history-runner.log"

  (
    cd "$ROOT_DIR"
    npm run agent:history || true
    npm run classify:pending || true
    npx tsx src/agent/reconcile-media-backlog.ts || true
  ) >>"$LOG_DIR/history-runner.log" 2>&1

  after="$(fetch_state)"
  echo "history-run $run after=$after" | tee -a "$LOG_DIR/history-runner.log"

  before_total="$(node -e "console.log(JSON.parse(process.argv[1]).total)" "$before")"
  after_total="$(node -e "console.log(JSON.parse(process.argv[1]).total)" "$after")"
  before_oldest="$(node -e "console.log(JSON.parse(process.argv[1]).oldest ?? '')" "$before")"
  after_oldest="$(node -e "console.log(JSON.parse(process.argv[1]).oldest ?? '')" "$after")"
  after_media="$(node -e "console.log(JSON.parse(process.argv[1]).mediaMissing)" "$after")"

  if [[ "$after_total" == "$before_total" && "$after_oldest" == "$before_oldest" ]]; then
    stable_runs=$((stable_runs + 1))
  else
    stable_runs=0
  fi

  if [[ "$stable_runs" -ge "$STABLE_TARGET" && "$after_media" == "0" ]]; then
    echo "history-runner completed: stable_runs=$stable_runs total=$after_total oldest=$after_oldest" | tee -a "$LOG_DIR/history-runner.log"
    exit 0
  fi
done

echo "history-runner stopped after $MAX_RUNS runs without full stabilization" | tee -a "$LOG_DIR/history-runner.log"
exit 0
