import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentResponse, hashIp, normalizeIp, validateLead } from './domain.js';

const BODY_LIMIT = 16 * 1024;
const problem = (status, code) => Object.assign(new Error(code), { status, code });

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw problem(415, 'UNSUPPORTED_MEDIA_TYPE');
  const declaredLength = Number(request.headers['content-length']);
  if (declaredLength > BODY_LIMIT) throw problem(413, 'PAYLOAD_TOO_LARGE');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > BODY_LIMIT) throw problem(413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw problem(400, 'INVALID_JSON'); }
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(JSON.stringify(body));
}

async function serveStatic(path, request, response, root) {
  if (!root || !['GET', 'HEAD'].includes(request.method)) return false;
  const name = path === '/' ? '/index.html' : path;
  const vendor = /^\/vendor\/[a-zA-Z0-9_./-]+\.js$/.test(name);
  if (!['/index.html', '/style.css', '/mobile.css', '/world.js', '/world-layout.js', '/world-products.js', '/lead-form.js', '/site-content.js'].includes(name) && !vendor) return false;
  try {
    const base = await realpath(root instanceof URL ? fileURLToPath(root) : root);
    const allowedRoot = vendor ? await realpath(resolve(base, 'vendor')) : base;
    const filename = await realpath(resolve(base, '.' + name));
    const inside = relative(allowedRoot, filename);
    if (inside === '..' || inside.startsWith('..' + sep) || resolve(allowedRoot, inside) !== filename) return false;
    const bytes = await readFile(filename);
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extname(filename)];
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return true;
  } catch { return false; }
}

export function createHandler({ store, salt, logger = () => {}, staticRoot, clientIpHeader = '', trustedProxyIps = [] }) {
  if (!salt) throw new Error('IP_HASH_SALT_REQUIRED');
  const proxies = new Set(trustedProxyIps.map(normalizeIp));
  if (clientIpHeader && (!/^[a-z0-9-]+$/.test(clientIpHeader) || proxies.size === 0)) throw new Error('INVALID_PROXY_CONFIGURATION');
  const log = entry => { try { logger(entry); } catch { /* Logging must not change a committed result. */ } };
  return async (request, response) => {
    const started = performance.now();
    let path = '';
    let rateChecked = false;
    try {
      const url = new URL(request.url, 'http://localhost');
      path = url.pathname;
      if (path === '/api/leads') {
        if (request.method !== 'POST') return send(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
        if (Number(request.headers['content-length']) > BODY_LIMIT) throw problem(413, 'PAYLOAD_TOO_LARGE');
        const peer = normalizeIp(request.socket.remoteAddress);
        const address = clientIpHeader && proxies.has(peer) ? request.headers[clientIpHeader] : peer;
        const ipHash = hashIp(address, salt);
        const rate = await store.consumeRateLimit(ipHash);
        rateChecked = true;
        if (!rate.allowed) return send(response, 429, { ok: false, error: 'RATE_LIMITED', retryAfter: rate.retryAfter }, { 'Retry-After': String(rate.retryAfter) });
        const input = validateLead(await readJson(request));
        const ua = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null;
        const id = await store.insertLead({ ...input, ua, ipHash });
        return send(response, id === null ? 200 : 201, id === null ? { ok: true, duplicate: true } : { ok: true, id });
      }
      if (path === '/api/content') {
        if (request.method !== 'GET') return send(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { Allow: 'GET' });
        const locale = url.searchParams.get('locale') ?? 'zh-CN';
        if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(locale) || locale.length > 32) throw problem(422, 'INVALID_LOCALE');
        return send(response, 200, contentResponse(locale, await store.getContent(locale)));
      }
      if (await serveStatic(path, request, response, staticRoot)) return;
      return send(response, 404, { ok: false, error: 'NOT_FOUND' });
    } catch (error) {
      const validation = ['INVALID_EMAIL', 'INVALID_PAYLOAD'].includes(error.code);
      const status = validation ? 422 : error.status ?? 503;
      const code = status === 503 ? 'SERVICE_UNAVAILABLE' : error.code;
      if (!response.destroyed && !response.headersSent) send(response, status, { ok: false, error: code });
    } finally {
      log({ route: ['/api/leads', '/api/content'].includes(path) ? path : 'static', status: response.statusCode, durationMs: Math.round(performance.now() - started) });
      if (rateChecked) {
        // This is an independent transaction after the rate lock has been released.
        try { await store.cleanupRateLimits(); }
        catch { log({ route: '/api/leads', error: 'RATE_CLEANUP_FAILED' }); }
      }
    }
  };
}
