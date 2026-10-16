import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteStore } from '../backend/stores/sqlite.js';

test('SQLite retains rolling history, independent IPs and exact expiry', async t => {
  let now = 59990;
  const store = new SqliteStore({ now: () => now });
  t.after(() => store.close());
  for (let i = 0; i < 5; i++) assert.equal((await store.consumeRateLimit('a')).allowed, true);
  now = 60001;
  assert.deepEqual(await store.consumeRateLimit('a'), { allowed: false, retryAfter: 60 });
  assert.equal((await store.consumeRateLimit('b')).allowed, true);
  now = 119990;
  assert.equal((await store.consumeRateLimit('a')).allowed, true);
});

test('SQLite unique index deduplicates email/source without conflating sources', async t => {
  const store = new SqliteStore();
  t.after(() => store.close());
  const lead = { email: 'a@b.com', source: 'site', scrollDepth: 0.8, chapter: 'portal', referrer: null, ua: 'test', ipHash: 'a'.repeat(64) };
  assert.equal(await store.insertLead(lead), 1);
  assert.equal(await store.insertLead(lead), null);
  assert.equal(await store.insertLead({ ...lead, source: 'other' }), 3);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM leads').get().n, 2);
});

test('SQLite seed preserves operator edits and does not use sort_order as identity', async t => {
  const store = new SqliteStore();
  t.after(() => store.close());
  await store.seedContent([{ chapter_key: 'genesis', locale: 'zh-CN', sort_order: 0, title: 'first\nline', tags: ['one'] }]);
  store.db.prepare("UPDATE site_content SET title = ?, sort_order = 99 WHERE chapter_key = 'genesis'").run('<script>alert(1)</script>');
  await store.seedContent([{ chapter_key: 'genesis', locale: 'zh-CN', sort_order: 0, title: 'overwrite', tags: [] }]);
  await store.seedContent([{ chapter_key: 'new-chapter', locale: 'zh-CN', sort_order: 1, tags: [] }]);
  const rows = await store.getContent('zh-CN');
  assert.equal(rows.find(r => r.chapter_key === 'genesis').title, '<script>alert(1)</script>');
  assert.equal(rows.find(r => r.chapter_key === 'genesis').sort_order, 99);
  assert.deepEqual(rows.find(r => r.chapter_key === 'genesis').tags, ['one']);
  assert.deepEqual(await store.getContent('en-US'), []);
});

test('SQLite TTL removes at most 100 stale rows and retains active hits', async t => {
  const now = 1000000000;
  const store = new SqliteStore({ now: () => now });
  t.after(() => store.close());
  for (let i = 0; i < 105; i++) store.db.prepare('INSERT INTO rate_limits VALUES (?, ?, ?)').run(`old-${i}`, '[]', now - 86400001);
  await store.consumeRateLimit('active');
  assert.equal(await store.cleanupRateLimits(), 100);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM rate_limits').get().n, 6);
  assert.equal((await store.consumeRateLimit('active')).allowed, true);
});
