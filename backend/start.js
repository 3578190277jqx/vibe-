import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createHandler } from './http.js';
import { openStore } from './stores/open.js';

try {
  const config = loadConfig();
  const store = await openStore(config);
  const handler = createHandler({
    store, salt: config.salt, clientIpHeader: config.clientIpHeader, trustedProxyIps: config.trustedProxyIps,
    staticRoot: new URL('../', import.meta.url), logger: entry => console.log(JSON.stringify(entry))
  });
  const active = new Set();
  const server = createServer((req, res) => {
    const task = handler(req, res);
    active.add(task);
    task.finally(() => active.delete(task));
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.setTimeout(10000, socket => socket.destroy());
  server.on('error', () => { console.error('SERVER_LISTEN_FAILED'); process.exitCode = 1; void store.close(); });
  server.listen(config.port, config.host, () => console.log(`AETHER backend: http://${config.host}:${config.port} (${config.database})`));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await new Promise(resolve => server.close(resolve));
    await Promise.allSettled([...active]);
    await store.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  console.error('BACKEND_START_FAILED: check environment configuration and docs/backend.md');
  process.exitCode = 1;
}
