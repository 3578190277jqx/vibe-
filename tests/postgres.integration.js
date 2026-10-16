// Runs only against an explicitly supplied test database, in a fresh schema.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { PostgresStore } from '../backend/stores/postgres.js';
import { initializePostgres } from '../backend/stores/init-postgres.js';
import { createHandler } from '../backend/http.js';
import { createServer } from 'node:http';
import { once } from 'node:events';

const connection = process.env.TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');

test('real PostgreSQL schema, concurrency, TTL, CMS and RLS', async t => {
  const schema = 'aether_test_' + randomUUID().replaceAll('-', '');
  const admin = postgres(connection, { max: 1, prepare: false, onnotice: () => {} });
  await admin`CREATE SCHEMA ${admin(schema)}`;
  const sql = postgres(connection, { max: 12, prepare: false, connection: { search_path: schema, statement_timeout: 5000 } });
  const store = new PostgresStore(sql);
  const readerRole = schema + '_reader';
  const bypassRole = schema + '_bypass';
  t.after(async () => {
    await store.close();
    await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
    await admin`DROP ROLE IF EXISTS ${admin(readerRole)}`;
    await admin`DROP ROLE IF EXISTS ${admin(bypassRole)}`;
    await admin.end();
  });
  await initializePostgres(sql);

  await t.test('reinitialization fails without migrating data or poisoning the pooled connection', async () => {
    await assert.rejects(initializePostgres(sql), { code: '42P07' });
    assert.equal(Number((await sql`SELECT count(*) FROM leads`)[0].count), 0);
    assert.equal((await sql`SELECT 1 AS alive`)[0].alive, 1);
  });

  await t.test('first burst across separate pool connections admits exactly five', async () => {
    const result = await Promise.all(Array.from({ length: 20 }, () => store.consumeRateLimit('a'.repeat(64))));
    assert.equal(result.filter(r => r.allowed).length, 5);
    assert.equal(result.filter(r => !r.allowed).length, 15);
    assert.ok(result.filter(r => !r.allowed).every(r => r.retryAfter >= 1 && r.retryAfter <= 60));
    const [row] = await sql`SELECT hits FROM rate_limits WHERE ip_hash = ${'a'.repeat(64)}`;
    assert.equal(row.hits.length, 5);
  });

  await t.test('dedupe is atomic and a failed write does not refund quota', async () => {
    const lead = { email: 'a@b.com', source: 'site', scrollDepth: 1, chapter: 'portal', referrer: null, ua: 'browser', ipHash: 'b'.repeat(64) };
    const ids = await Promise.all(Array.from({ length: 12 }, () => store.insertLead(lead)));
    assert.equal(ids.filter(id => id !== null).length, 1);
    assert.equal(Number((await sql`SELECT count(*) FROM leads`)[0].count), 1);
    await store.consumeRateLimit(lead.ipHash);
    await assert.rejects(store.insertLead({ ...lead, source: 'x'.repeat(65) }));
    assert.equal((await sql`SELECT hits FROM rate_limits WHERE ip_hash = ${lead.ipHash}`)[0].hits.length, 1);
  });

  await t.test('window clock is sampled after a contended row lock and prunes expired hits', async () => {
    await sql`INSERT INTO rate_limits (ip_hash, hits)
      SELECT 'contended', array_fill((floor(extract(epoch FROM clock_timestamp()) * 1000) - 59800)::bigint, ARRAY[5])`;
    let unlock, notifyLocked;
    const barrier = new Promise(resolve => { unlock = resolve; });
    const locked = new Promise(resolve => { notifyLocked = resolve; });
    const blocker = sql.begin(async tx => {
      await tx`SELECT * FROM rate_limits WHERE ip_hash = 'contended' FOR UPDATE`;
      notifyLocked();
      await barrier;
    });
    await locked;
    const pending = store.consumeRateLimit('contended');
    try { await new Promise(resolve => setTimeout(resolve, 350)); }
    finally { unlock(); }
    await blocker;
    assert.equal((await pending).allowed, true);
    assert.equal((await sql`SELECT hits FROM rate_limits WHERE ip_hash = 'contended'`)[0].hits.length, 1);
  });

  await t.test('CMS uses arrays, stable keys, non-destructive seeds and updated_at trigger', async () => {
    await store.seedContent([{ chapter_key: 'genesis', locale: 'zh-CN', sort_order: 0, title: 'first\nline', tags: ['a', 'b'] }]);
    await sql`UPDATE site_content SET title = '<b>operator</b>', sort_order = 99, updated_at = '2000-01-01'`;
    await store.seedContent([{ chapter_key: 'genesis', locale: 'zh-CN', sort_order: 0, title: 'overwrite', tags: [] }]);
    const [row] = await store.getContent('zh-CN');
    assert.equal(row.title, '<b>operator</b>');
    assert.equal(row.sort_order, 99);
    assert.deepEqual(row.tags, ['a', 'b']);
    assert.ok(row.updated_at.getFullYear() > 2000);
    assert.deepEqual(await store.getContent('en-US'), []);
  });

  await t.test('TTL skips locked rows, deletes at most 100 and permits old IPs again', async () => {
    await sql`INSERT INTO rate_limits (ip_hash, hits, updated_at)
      SELECT 'old-' || n, ARRAY[1::bigint], clock_timestamp() - interval '2 days' FROM generate_series(1,105) AS n`;
    await sql.begin(async tx => {
      await tx`SELECT * FROM rate_limits WHERE ip_hash = 'old-1' FOR UPDATE`;
      assert.equal(await store.cleanupRateLimits(), 100);
      assert.equal((await tx`SELECT ip_hash FROM rate_limits WHERE ip_hash = 'old-1'`).length, 1);
    });
    assert.equal(Number((await sql`SELECT count(*) FROM rate_limits WHERE ip_hash LIKE 'old-%'`)[0].count), 5);
    assert.equal((await store.consumeRateLimit('old-1')).allowed, true);
    assert.equal((await sql`SELECT hits FROM rate_limits WHERE ip_hash = 'old-1'`)[0].hits.length, 1);
  });

  await t.test('RLS defaults to deny for normal roles while BYPASSRLS bypasses it', async () => {
    await admin`CREATE ROLE ${admin(readerRole)} NOLOGIN`;
    await admin`CREATE ROLE ${admin(bypassRole)} NOLOGIN BYPASSRLS`;
    for (const role of [readerRole, bypassRole]) {
      await admin`GRANT USAGE ON SCHEMA ${admin(schema)} TO ${admin(role)}`;
      await admin`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ${admin(schema)} TO ${admin(role)}`;
      await admin`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${admin(schema)} TO ${admin(role)}`;
    }
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE ${tx(readerRole)}`;
      assert.equal((await tx`SELECT * FROM leads`).length, 0);
      assert.equal((await tx`SELECT * FROM site_content`).length, 0);
      assert.equal((await tx`SELECT * FROM rate_limits`).length, 0);
    });
    await assert.rejects(sql.begin(async tx => {
      await tx`SET LOCAL ROLE ${tx(readerRole)}`;
      await tx`INSERT INTO leads (email) VALUES ('denied@example.com')`;
    }), { code: '42501' });
    await sql.begin(async tx => {
      await tx`SET LOCAL ROLE ${tx(bypassRole)}`;
      assert.equal((await tx`SELECT * FROM leads`).length, 1);
    });
  });

  await t.test('HTTP contract over PostgreSQL counts invalid requests before validation', async () => {
    const server = createServer(createHandler({ store, salt: 'private-test-salt' }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (let i = 0; i < 6; i++) {
        const r = await fetch(base + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"invalid"}' });
        assert.equal(r.status, i < 5 ? 422 : 429);
        await r.json();
      }
      const r = await fetch(base + '/api/content');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal((await r.json()).chapters[0].key, 'genesis');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});
