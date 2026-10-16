import { readFile } from 'node:fs/promises';
import { loadConfig } from '../backend/config.js';
import { openStore } from '../backend/stores/open.js';

let store;
try {
  store = await openStore(loadConfig());
  const content = JSON.parse(await readFile(new URL('../backend/content.json', import.meta.url), 'utf8'));
  await store.seedContent(content);
  console.log('Default content seeded. Existing operator edits were preserved.');
} catch {
  console.error('CONTENT_SEED_FAILED: check configuration and initialize the schema first.');
  process.exitCode = 1;
} finally { if (store) await store.close(); }
