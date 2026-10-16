import { loadConfig } from '../backend/config.js';
import { openStore } from '../backend/stores/open.js';
import { initializePostgres } from '../backend/stores/init-postgres.js';

let store;
try {
  const config = loadConfig();
  if (config.database === 'postgres' && !process.argv.includes('--confirm')) {
    throw new Error('CONFIRM_REQUIRED');
  }
  store = await openStore(config);
  if (config.database === 'postgres') await initializePostgres(store.sql);
  console.log('Database initialized. Existing PostgreSQL tables are never automatically migrated.');
} catch (error) {
  console.error(error.message === 'CONFIRM_REQUIRED'
    ? 'For a NEW PostgreSQL schema only: npm run db:init -- --confirm'
    : 'DB_INIT_FAILED: check configuration and schema compatibility; no automatic migration is performed.');
  process.exitCode = 1;
} finally { if (store) await store.close(); }
