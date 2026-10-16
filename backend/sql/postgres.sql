-- PostgreSQL only. Run explicitly against a NEW database/schema.
-- This script intentionally does not silently migrate existing tables.
BEGIN;
CREATE TABLE leads (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'aether-landing',
  scroll_depth REAL,
  chapter VARCHAR(32),
  referrer TEXT,
  ua TEXT,
  ip_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leads_created_at_idx ON leads (created_at DESC);
CREATE UNIQUE INDEX leads_email_source_uidx ON leads (email, source);

CREATE TABLE rate_limits (
  ip_hash TEXT PRIMARY KEY,
  hits BIGINT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rate_limits_updated_at_idx ON rate_limits (updated_at);

CREATE TABLE site_content (
  chapter_key TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  sort_order INT NOT NULL,
  eyebrow TEXT,
  title TEXT,
  body TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chapter_key, locale)
);
CREATE FUNCTION touch_site_content_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER site_content_updated_at_trigger
BEFORE UPDATE ON site_content FOR EACH ROW
EXECUTE FUNCTION touch_site_content_updated_at();

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON leads, rate_limits, site_content FROM PUBLIC;
REVOKE ALL ON SEQUENCE leads_id_seq FROM PUBLIC;
-- No anonymous/permissive policies. Owners and BYPASSRLS roles bypass RLS.
COMMIT;
