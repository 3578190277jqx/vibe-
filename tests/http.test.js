import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { createHandler } from '../backend/http.js';
import { SqliteStore } from '../backend/stores/sqlite.js';

async function setup(t, options = {}) {
  const store = new SqliteStore();
  const logs = [];
  const server = createServer(createHandler({ store, salt: 'test-private-salt', logger: entry => logs.push(entry), ...options }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await store.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(url + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'actual-browser' }, body: JSON.stringify(body) });
  return { store, url, post, logs };
}

test('HTTP creates real rows, deduplicates normalized emails and ignores forged IP/UA', async t => {
  const { store, post, logs } = await setup(t);
  const input = { email: '  USER@Example.com ', scrollDepth: 0, chapter: 'portal', referrer: 'https://example.com/', ua: 'forged', ip_hash: 'forged' };
  let response = await post(input);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, id: 1 });
  response = await post({ ...input, email: 'user@example.COM' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, duplicate: true });
  const row = store.db.prepare('SELECT * FROM leads').get();
  assert.equal(row.email, 'user@example.com');
  assert.equal(row.ua, 'actual-browser');
  assert.match(row.ip_hash, /^[a-f0-9]{64}$/);
  assert.equal(row.scroll_depth, 0);
  assert.ok(!JSON.stringify(logs).includes('127.0.0.1'));
  assert.ok(!JSON.stringify(logs).includes('user@example.com'));
});

test('HTTP counts five invalid emails before sixth returns 429 even with forged forwarding headers', async t => {
  const { post, url } = await setup(t);
  for (let i = 0; i < 5; i++) {
    const response = await post({ email: 'invalid' });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { ok: false, error: 'INVALID_EMAIL' });
  }
  const response = await fetch(url + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.77' }, body: '{bad json' });
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, 'RATE_LIMITED');
  assert.ok(body.retryAfter >= 1 && body.retryAfter <= 60);
  assert.equal(response.headers.get('retry-after'), String(body.retryAfter));
});

test('HTTP validates transport errors and methods without exposing internal data', async t => {
  const { url, post } = await setup(t);
  let response = await fetch(url + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(response.status, 400);
  assert.equal((await post({ email: 'a@b.com', scrollDepth: '0.5' })).status, 422);
  response = await fetch(url + '/api/leads');
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  response = await fetch(url + '/api/content', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('HTTP CMS preserves stable keys, literal HTML, newline, missing fields and no-store', async t => {
  const { store, url } = await setup(t);
  await store.seedContent([{ chapter_key: 'genesis', locale: 'zh-CN', sort_order: 99, title: '<img onerror=alert(1)>\nline', tags: ['<b>literal</b>'] }]);
  let response = await fetch(url + '/api/content?locale=zh-CN');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { locale: 'zh-CN', chapters: [{ key: 'genesis', sortOrder: 99, title: '<img onerror=alert(1)>\nline', tags: ['<b>literal</b>'] }] });
  response = await fetch(url + '/api/content?locale=en-US');
  assert.deepEqual(await response.json(), { locale: 'en-US', chapters: [] });
  store.db.prepare("UPDATE site_content SET tags = 'invalid json'").run();
  response = await fetch(url + '/api/content');
  const body = await response.json();
  assert.equal(body.chapters[0].title, '<img onerror=alert(1)>\nline');
  assert.ok(!('tags' in body.chapters[0]));
});

test('HTTP failures retain consumed quota and return safe 503', async t => {
  const { store, post, url } = await setup(t);
  store.db.exec('DROP TABLE leads');
  for (let i = 0; i < 5; i++) {
    const response = await post({ email: 'a@b.com' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'SERVICE_UNAVAILABLE' });
  }
  assert.equal((await post({ email: 'a@b.com' })).status, 429);
  store.db.exec('DROP TABLE site_content');
  const response = await fetch(url + '/api/content');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('HTTP cleanup failure cannot turn a committed lead into failure or leak errors', async t => {
  const { store, post, logs } = await setup(t);
  store.cleanupRateLimits = async () => { throw new Error('private database connection string'); };
  const response = await post({ email: 'a@b.com' });
  assert.equal(response.status, 201);
  await response.json();
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM leads').get().n, 1);
  assert.ok(logs.some(e => e.error === 'RATE_CLEANUP_FAILED'));
  assert.ok(!JSON.stringify(logs).includes('private database'));
});

test('HTTP rejects oversized chunked bodies with a clear 413 response', async t => {
  const { url } = await setup(t);
  const result = await new Promise((resolve, reject) => {
    const req = request(url + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write('{"email":"');
    req.end('a'.repeat(17000) + '@example.com"}');
  });
  assert.equal(result.status, 413);
  assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'PAYLOAD_TOO_LARGE' });
});

test('HTTP trusted proxy supports independent IP quotas and fails closed on malformed headers', async t => {
  const { url } = await setup(t, { clientIpHeader: 'x-real-ip', trustedProxyIps: ['127.0.0.1'] });
  const post = (ip, email) => fetch(url + '/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip }, body: JSON.stringify({ email }) });
  for (let i = 0; i < 5; i++) assert.equal((await post('192.0.2.1', 'invalid')).status, 422);
  assert.equal((await post('192.0.2.1', 'a@b.com')).status, 429);
  assert.equal((await post('192.0.2.2', 'a@b.com')).status, 201);
  assert.equal((await post('192.0.2.2, 192.0.2.3', 'b@b.com')).status, 503);
});

test('HTTP serves only frontend assets and never backend, environment or database files', async t => {
  const { url } = await setup(t, { staticRoot: new URL('../', import.meta.url) });
  for (const path of ['/backend/http.js', '/.env', '/package.json', '/.git/config', '/README.md', '/backend/sql/postgres.sql', '/vendor/../../package.json']) {
    assert.equal((await fetch(url + path)).status, 404, path);
  }
  assert.equal((await fetch(url + '/')).status, 200);
  assert.equal((await fetch(url + '/vendor/three.module.js')).status, 200);
  assert.equal((await fetch(url + '/world-layout.js')).status, 200);
  assert.equal((await fetch(url + '/world-products.js')).status, 200);
  assert.equal((await fetch(url + '/lead-form.js')).status, 200);
  assert.equal((await fetch(url + '/site-content.js')).status, 200);
});
