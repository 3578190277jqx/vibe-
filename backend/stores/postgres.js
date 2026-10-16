import { windowDecision } from '../domain.js';

export class PostgresStore {
  constructor(sql) { this.sql = sql; }

  async consumeRateLimit(ipHash) {
    return this.sql.begin(async tx => {
      let row;
      // Cleanup can delete a stale existing row between the upsert and lock.
      for (let attempt = 0; attempt < 3 && !row; attempt++) {
        await tx`INSERT INTO rate_limits (ip_hash) VALUES (${ipHash}) ON CONFLICT (ip_hash) DO NOTHING`;
        [row] = await tx`SELECT hits FROM rate_limits WHERE ip_hash = ${ipHash} FOR UPDATE`;
      }
      if (!row) throw new Error('RATE_LOCK_UNAVAILABLE');
      const [clock] = await tx`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS ms`;
      const decision = windowDecision(row.hits, Number(clock.ms));
      await tx`UPDATE rate_limits SET hits = ${tx.array(decision.hits, 20)}, updated_at = clock_timestamp() WHERE ip_hash = ${ipHash}`;
      return { allowed: decision.allowed, retryAfter: decision.retryAfter };
    });
  }

  async insertLead(lead) {
    const rows = await this.sql`INSERT INTO leads (email, source, scroll_depth, chapter, referrer, ua, ip_hash)
      VALUES (${lead.email}, ${lead.source}, ${lead.scrollDepth}, ${lead.chapter}, ${lead.referrer}, ${lead.ua}, ${lead.ipHash})
      ON CONFLICT (email, source) DO NOTHING RETURNING id`;
    if (!rows.length) return null;
    const id = Number(rows[0].id);
    if (!Number.isSafeInteger(id)) throw new Error('LEAD_ID_OUT_OF_RANGE');
    return id;
  }

  async getContent(locale) {
    // Alphabetic order is deterministic but never claims to define scene order.
    const rows = await this.sql`SELECT chapter_key, locale, sort_order, eyebrow, title, body, tags, updated_at
      FROM site_content WHERE locale = ${locale} ORDER BY chapter_key`;
    return Array.from(rows);
  }

  async seedContent(rows) {
    await this.sql.begin(async tx => {
      for (const row of rows) await tx`INSERT INTO site_content (chapter_key, locale, sort_order, eyebrow, title, body, tags)
        VALUES (${row.chapter_key}, ${row.locale}, ${row.sort_order}, ${row.eyebrow ?? null}, ${row.title ?? null}, ${row.body ?? null}, ${tx.array(row.tags ?? [], 25)})
        ON CONFLICT (chapter_key, locale) DO NOTHING`;
    });
  }

  async cleanupRateLimits() {
    return this.sql.begin(async tx => {
      const rows = await tx`WITH expired AS (
        SELECT ip_hash FROM rate_limits
        WHERE updated_at < clock_timestamp() - interval '1 day'
        ORDER BY updated_at LIMIT 100 FOR UPDATE SKIP LOCKED
      ) DELETE FROM rate_limits USING expired
        WHERE rate_limits.ip_hash = expired.ip_hash RETURNING rate_limits.ip_hash`;
      return rows.length;
    });
  }

  async close() { await this.sql.end({ timeout: 5 }); }
}
