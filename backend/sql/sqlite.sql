-- Development only. Production schema: postgres.sql.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'aether-landing',
  scroll_depth REAL,
  chapter TEXT,
  referrer TEXT,
  ua TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (email, source)
);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash TEXT PRIMARY KEY,
  hits TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_updated_at_idx ON rate_limits (updated_at);
CREATE TABLE IF NOT EXISTS site_content (
  chapter_key TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  sort_order INTEGER NOT NULL,
  eyebrow TEXT,
  title TEXT,
  body TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (chapter_key, locale)
);
CREATE TRIGGER IF NOT EXISTS site_content_updated_at_trigger
AFTER UPDATE OF eyebrow, title, body, tags, sort_order, chapter_key, locale ON site_content
BEGIN
  UPDATE site_content SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE chapter_key = NEW.chapter_key AND locale = NEW.locale;
END;
