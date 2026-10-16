import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

function invalid(code) {
  return Object.assign(new Error(code), { code });
}

export function validateLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('INVALID_PAYLOAD');
  if (typeof body.email !== 'string') throw invalid('INVALID_EMAIL');
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(email)) {
    throw invalid('INVALID_EMAIL');
  }
  const source = body.source === undefined ? 'aether-landing' : body.source;
  if (typeof source !== 'string' || !source.trim() || [...source].length > 64 || source.includes('\0')) throw invalid('INVALID_PAYLOAD');
  const { scrollDepth, chapter, referrer, company_website: trap } = body;
  if (scrollDepth !== undefined && (typeof scrollDepth !== 'number' || !Number.isFinite(scrollDepth) || scrollDepth < 0 || scrollDepth > 1)) throw invalid('INVALID_PAYLOAD');
  for (const [value, limit] of [[chapter, 32], [referrer, Infinity]]) {
    if (value !== undefined && (typeof value !== 'string' || [...value].length > limit || value.includes('\0'))) throw invalid('INVALID_PAYLOAD');
  }
  if (trap !== undefined && trap !== '') throw invalid('INVALID_PAYLOAD');
  return { email, source, scrollDepth: scrollDepth ?? null, chapter: chapter ?? null, referrer: referrer ?? null };
}

export function windowDecision(timestamps, nowMs) {
  if (!Array.isArray(timestamps) || !timestamps.every(t => Number.isSafeInteger(Number(t)) && Number(t) >= 0)) {
    throw new Error('INVALID_RATE_STATE');
  }
  const hits = timestamps.map(Number).filter(t => t > nowMs - 60000).sort((a, b) => a - b);
  if (hits.length >= 5) return { allowed: false, hits, retryAfter: Math.max(1, Math.ceil((hits[0] + 60000 - nowMs) / 1000)) };
  hits.push(nowMs);
  hits.sort((a, b) => a - b);
  return { allowed: true, hits, retryAfter: 0 };
}

export function normalizeIp(address) {
  if (typeof address !== 'string' || !isIP(address)) throw new Error('INVALID_CLIENT_IP');
  if (isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f\d]+):([a-f\d]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const a = parseInt(mapped[1], 16), b = parseInt(mapped[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

export function hashIp(address, salt) {
  if (typeof salt !== 'string' || !salt) throw new Error('IP_HASH_SALT_REQUIRED');
  return createHash('sha256').update(salt).update(normalizeIp(address)).digest('hex');
}

export function contentResponse(locale, rows) {
  return {
    locale,
    chapters: rows.map(row => {
      const chapter = { key: row.chapter_key, sortOrder: row.sort_order };
      for (const field of ['eyebrow', 'title', 'body']) if (typeof row[field] === 'string') chapter[field] = row[field];
      if (Array.isArray(row.tags) && row.tags.every(t => typeof t === 'string')) chapter.tags = row.tags;
      return chapter;
    })
  };
}
