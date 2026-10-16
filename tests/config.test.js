import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../backend/config.js';

test('requires salt and fails closed on unknown database or partial proxy configuration', () => {
  assert.throws(() => loadConfig({}), /IP_HASH_SALT/);
  const base = { IP_HASH_SALT: 'a'.repeat(32) };
  assert.equal(loadConfig(base).database, 'sqlite');
  assert.throws(() => loadConfig({ ...base, DATABASE_KIND: 'typo' }), /DATABASE_KIND/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /PostgreSQL/);
  assert.throws(() => loadConfig({ ...base, DATABASE_KIND: 'postgres' }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ ...base, CLIENT_IP_HEADER: 'x-real-ip' }), /proxy/i);
  assert.throws(() => loadConfig({ ...base, TRUSTED_PROXY_IPS: '127.0.0.1' }), /proxy/i);
  assert.throws(() => loadConfig({ ...base, PORT: '-1' }), /PORT/);
  assert.equal(loadConfig({ ...base, CLIENT_IP_HEADER: 'X-Real-IP', TRUSTED_PROXY_IPS: '127.0.0.1,::1' }).clientIpHeader, 'x-real-ip');
});
