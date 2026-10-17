import assert from 'node:assert/strict';
import test from 'node:test';
import { postLead } from '../lead-form.js';

const payload = { email: 'user@example.com', source: 'aether-landing', scrollDepth: 1, chapter: 'portal', referrer: '', company_website: '' };
const reply = (status, data, headers) => new Response(JSON.stringify(data), { status, headers });

test('lead client sends the agreed payload and only accepts confirmed insert or duplicate', async () => {
  let sent;
  const result = await postLead(payload, { fetchImpl: async (url, options) => {
    sent = { url, ...options };
    return reply(201, { ok: true, id: 123 });
  } });
  assert.deepEqual(result, { state: 'success' });
  assert.equal(sent.url, '/api/leads');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers['Content-Type'], 'application/json');
  assert.equal(sent.cache, 'no-store');
  assert.deepEqual(JSON.parse(sent.body), payload);
  assert.deepEqual(await postLead(payload, { fetchImpl: async () => reply(200, { ok: true, duplicate: true }) }), { state: 'duplicate' });
  for (const [status, body] of [[200, { ok: true }], [201, { ok: true }], [201, { ok: false }], [201, { ok: true, id: '123' }]]) {
    assert.deepEqual(await postLead(payload, { fetchImpl: async () => reply(status, body) }), { state: 'unavailable' });
  }
});

test('lead client distinguishes validation, actual retry delay, server and malformed responses', async () => {
  assert.deepEqual(await postLead(payload, { fetchImpl: async () => reply(422, { ok: false, error: 'INVALID_EMAIL' }) }), { state: 'invalid-email' });
  assert.deepEqual(await postLead(payload, { fetchImpl: async () => reply(422, { ok: false, error: 'INVALID_PAYLOAD' }) }), { state: 'invalid-payload' });
  assert.deepEqual(await postLead(payload, { fetchImpl: async () => reply(429, { ok: false, error: 'RATE_LIMITED', retryAfter: 17 }) }), { state: 'rate-limited', retryAfter: 17 });
  assert.deepEqual(await postLead(payload, { fetchImpl: async () => reply(429, { ok: false, error: 'RATE_LIMITED' }, { 'Retry-After': '9' }) }), { state: 'rate-limited', retryAfter: 9 });
  for (const status of [400, 404, 413, 503]) {
    assert.deepEqual(await postLead(payload, { fetchImpl: async () => reply(status, { ok: false, error: 'SERVICE_UNAVAILABLE' }) }), { state: 'unavailable' });
  }
  assert.deepEqual(await postLead(payload, { fetchImpl: async () => new Response('<html>proxy error</html>', { status: 200 }) }), { state: 'unavailable' });
});

test('lead client handles offline and aborts both the fetch and a stalled response body', async () => {
  assert.deepEqual(await postLead(payload, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), { state: 'network-error' });
  for (const bodyStarted of [false, true]) {
    let aborted = false;
    const fetchImpl = (_url, { signal }) => {
      const pending = new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true }));
      return bodyStarted ? Promise.resolve({ status: 201, json: () => pending }) : pending;
    };
    assert.deepEqual(await postLead(payload, { fetchImpl, timeoutMs: 15 }), { state: 'timeout' });
    assert.equal(aborted, true);
  }
});
