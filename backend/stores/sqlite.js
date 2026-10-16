import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { windowDecision } from '../domain.js';

export class SqliteStore {
  constructor({ filename = ':memory:', now = Date.now } = {}) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename, { timeout: 5000 });
    this.now = now;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(readFileSync(new URL('../sql/sqlite.sql', import.meta.url), 'utf8'));
  }

  async consumeRateLimit(ipHash) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.now();
      this.db.prepare('INSERT INTO rate_limits (ip_hash, hits, updated_at) VALUES (?, ?, ?) ON CONFLICT (ip_hash) DO NOTHING').run(ipHash, '[]', now);
      const row = this.db.prepare('SELECT hits FROM rate_limits WHERE ip_hash = ?').get(ipHash);
      const decision = windowDecision(JSON.parse(row.hits), now);
      this.db.prepare('UPDATE rate_limits SET hits = ?, updated_at = ? WHERE ip_hash = ?').run(JSON.stringify(decision.hits), now, ipHash);
      this.db.exec('COMMIT');
      return { allowed: decision.allowed, retryAfter: decision.retryAfter };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async insertLead(lead) {
    const row = this.db.prepare(`INSERT INTO leads
      (email, source, scroll_depth, chapter, referrer, ua, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (email, source) DO NOTHING RETURNING id`)
      .get(lead.email, lead.source, lead.scrollDepth, lead.chapter, lead.referrer, lead.ua, lead.ipHash);
    return row ? row.id : null;
  }

  async getContent(locale) {
    return this.db.prepare('SELECT * FROM site_content WHERE locale = ? ORDER BY chapter_key').all(locale).map(row => {
      try { row.tags = JSON.parse(row.tags); } catch { row.tags = null; }
      return row;
    });
  }

  async seedContent(rows) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare(`INSERT INTO site_content
        (chapter_key, locale, sort_order, eyebrow, title, body, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (chapter_key, locale) DO NOTHING`);
      for (const row of rows) insert.run(row.chapter_key, row.locale, row.sort_order, row.eyebrow ?? null, row.title ?? null, row.body ?? null, JSON.stringify(row.tags ?? []));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async cleanupRateLimits() {
    const result = this.db.prepare(`DELETE FROM rate_limits WHERE ip_hash IN
      (SELECT ip_hash FROM rate_limits WHERE updated_at < ? ORDER BY updated_at LIMIT 100)`)
      .run(this.now() - 86400000);
    return result.changes;
  }

  async close() { this.db.close(); }
}
