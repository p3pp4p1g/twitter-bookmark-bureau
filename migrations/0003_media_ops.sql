CREATE TABLE IF NOT EXISTS media_assets (
  bookmark_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  thumbnail_url TEXT,
  media_type TEXT NOT NULL,
  content_hash TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bookmark_id, media_id),
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_status ON media_assets(status);
CREATE INDEX IF NOT EXISTS idx_media_assets_bookmark_id ON media_assets(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_content_hash ON media_assets(content_hash);
CREATE INDEX IF NOT EXISTS idx_media_assets_r2_key ON media_assets(r2_key);

CREATE TABLE IF NOT EXISTS alert_events (
  fingerprint TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  resolved_at TEXT,
  last_notified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alert_events_code ON alert_events(code);
CREATE INDEX IF NOT EXISTS idx_alert_events_resolved_at ON alert_events(resolved_at);
