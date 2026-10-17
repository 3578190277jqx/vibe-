import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSiteContent } from '../site-content.js';

const chapters = [{ key: 'portal', sortOrder: -100, title: '下一段\n故事', tags: ['前端'] }];

test('CMS client requests exact locale without cache and preserves stable keys', async () => {
  let request;
  const result = await fetchSiteContent({ locale: 'zh-CN', fetchImpl: async (url, options) => {
    request = { url, ...options };
    return Response.json({ locale: 'zh-CN', chapters });
  } });
  assert.deepEqual(result, chapters);
  assert.equal(request.url, '/api/content?locale=zh-CN');
  assert.equal(request.method, 'GET');
  assert.equal(request.cache, 'no-store');
});

test('CMS client tolerates empty content and rejects failed, wrong-locale and malformed responses', async () => {
  assert.deepEqual(await fetchSiteContent({ fetchImpl: async () => Response.json({ locale: 'zh-CN', chapters: [] }) }), []);
  for (const fetchImpl of [
    async () => Response.json({ ok: false }, { status: 503 }),
    async () => new Response('<html>proxy</html>'),
    async () => Response.json({ chapters: {} }),
    async () => Response.json(null),
    async () => Response.json({ locale: 'en-US', chapters }),
    async () => { throw new TypeError('Failed to fetch'); }
  ]) {
    assert.equal(await fetchSiteContent({ fetchImpl }), null);
  }
});

test('CMS client aborts stalled requests and bodies without rejecting into world error handlers', async () => {
  for (const bodyStarted of [false, true]) {
    let aborted = false;
    const fetchImpl = (_url, { signal }) => {
      const pending = new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true }));
      return bodyStarted ? Promise.resolve({ ok: true, json: () => pending }) : pending;
    };
    assert.equal(await fetchSiteContent({ fetchImpl, timeoutMs: 15 }), null);
    assert.equal(aborted, true);
  }
});
