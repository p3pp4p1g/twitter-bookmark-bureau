CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'llm',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  author_id TEXT,
  created_at TEXT NOT NULL,
  lang TEXT,
  links_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '[]',
  has_media INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  raw_json TEXT,
  summary TEXT,
  category_slug TEXT,
  category_name TEXT,
  category_confidence REAL,
  category_reason TEXT,
  manual_category_slug TEXT,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (category_slug) REFERENCES categories(slug),
  FOREIGN KEY (manual_category_slug) REFERENCES categories(slug)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_author_handle ON bookmarks(author_handle);
CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category_slug);
CREATE INDEX IF NOT EXISTS idx_bookmarks_manual_category ON bookmarks(manual_category_slug);
CREATE INDEX IF NOT EXISTS idx_bookmarks_has_media ON bookmarks(has_media);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  snapshot_key TEXT,
  created_at TEXT NOT NULL
);
