import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLead, windowDecision, normalizeIp, hashIp } from '../backend/domain.js';

test('normalizes email and defaults source without trusting metadata', () => {
  assert.deepEqual(validateLead({ email: '  USER@Example.COM  ', ua: 'forged', ip_hash: 'forged' }), {
    email: 'user@example.com', source: 'aether-landing', scrollDepth: null, chapter: null, referrer: null
  });
});

test('rejects invalid emails and oversized normalized addresses', () => {
  for (const email of [null, 42, '', 'a@b', 'a b@c.com', 'a@@b.com', 'a'.repeat(250) + '@b.com']) {
    assert.throws(() => validateLead({ email }), { code: 'INVALID_EMAIL' });
  }
});

test('rejects optional field types, ranges, empty source, and honeypot', () => {
  for (const invalid of [
    { source: '' }, { source: '  ' }, { source: 'a'.repeat(65) }, { source: null },
    { scrollDepth: -0.01 }, { scrollDepth: 1.01 }, { scrollDepth: Infinity },
    { scrollDepth: NaN }, { scrollDepth: '0.5' }, { scrollDepth: null },
    { chapter: 1 }, { chapter: 'x'.repeat(33) }, { referrer: {} },
    { company_website: 'bot.example' }, { company_website: false }
  ]) assert.throws(() => validateLead({ email: 'a@b.com', ...invalid }), { code: 'INVALID_PAYLOAD' });
  for (const body of [null, [], 'email']) assert.throws(() => validateLead(body), { code: 'INVALID_PAYLOAD' });
  for (const scrollDepth of [0, 1]) assert.equal(validateLead({ email: 'a@b.com', scrollDepth }).scrollDepth, scrollDepth);
});

test('rolling window expires at exactly 60 seconds and rounds Retry-After up', () => {
  assert.deepEqual(windowDecision([1000, 1100, 1200, 1300, 1400], 60999), {
    allowed: false, hits: [1000, 1100, 1200, 1300, 1400], retryAfter: 1
  });
  assert.deepEqual(windowDecision([1000, 1100, 1200, 1300, 1400], 61000), {
    allowed: true, hits: [1100, 1200, 1300, 1400, 61000], retryAfter: 0
  });
  assert.equal(windowDecision([1000, 1100, 1200, 1300, 1400], 1001).retryAfter, 60);
});

test('rolling window does not reset on a wall-clock minute boundary or append rejected hits', () => {
  const hits = [59990, 59991, 59992, 59993, 59994];
  assert.deepEqual(windowDecision(hits, 60001), { allowed: false, hits, retryAfter: 60 });
  assert.equal(windowDecision(hits, 119990).allowed, true);
});

test('canonical IPs share a salted SHA-256 key and malformed IPs are rejected', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeIp('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(hashIp('::ffff:127.0.0.1', 'salt'), hashIp('127.0.0.1', 'salt'));
  assert.match(hashIp('127.0.0.1', 'salt'), /^[a-f0-9]{64}$/);
  assert.notEqual(hashIp('127.0.0.1', 'salt'), hashIp('127.0.0.1', 'other'));
  assert.throws(() => normalizeIp('garbage'));
  assert.throws(() => hashIp('127.0.0.1', ''));
});
