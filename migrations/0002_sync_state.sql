CREATE TABLE IF NOT EXISTS sync_state (
  source TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  last_cursor TEXT,
  last_stats_json TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
