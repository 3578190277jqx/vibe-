import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('CLI initializes and seeds seven current brand chapters without overwriting operator edits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aether-cli-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, 'test.sqlite');
  const env = { ...process.env, NODE_ENV: 'development', DATABASE_KIND: 'sqlite', SQLITE_PATH: filename, IP_HASH_SALT: 'a'.repeat(32) };
  const run = script => {
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  run('scripts/init-db.js');
  run('scripts/seed-content.js');
  const db = new DatabaseSync(filename);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM site_content').get().n, 7);
    assert.equal(db.prepare("SELECT title FROM site_content WHERE chapter_key = 'genesis'").get().title, '让一个品牌\n成为一段体验');
    assert.equal(db.prepare("SELECT sort_order FROM site_content WHERE chapter_key = 'products'").get().sort_order, 5);
    assert.equal(db.prepare("SELECT sort_order FROM site_content WHERE chapter_key = 'portal'").get().sort_order, 6);
    db.prepare("UPDATE site_content SET title = 'operator' WHERE chapter_key = 'genesis'").run();
    run('scripts/seed-content.js');
    assert.equal(db.prepare("SELECT title FROM site_content WHERE chapter_key = 'genesis'").get().title, 'operator');
  } finally { db.close(); }
});

test('CLI refuses unconfirmed PostgreSQL initialization before connecting and never prints credentials', () => {
  const result = spawnSync(process.execPath, ['scripts/init-db.js'], {
    encoding: 'utf8', env: { ...process.env, NODE_ENV: 'development', DATABASE_KIND: 'postgres', DATABASE_URL: 'postgres://user:private-password@invalid/private', IP_HASH_SALT: 'a'.repeat(32) }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--confirm/);
  assert.ok(!result.stderr.includes('private-password'));
});
