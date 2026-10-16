import { readFile } from 'node:fs/promises';

export async function openStore(config) {
  if (config.database === 'sqlite') {
    const { SqliteStore } = await import('./sqlite.js');
    return new SqliteStore({ filename: config.filename });
  }
  const [{ default: postgres }, { PostgresStore }] = await Promise.all([import('postgres'), import('./postgres.js')]);
  const ssl = config.ssl === 'disable' ? false : {
    rejectUnauthorized: true,
    ...(config.caFile ? { ca: await readFile(config.caFile, 'utf8') } : {})
  };
  const sql = postgres(config.databaseUrl, {
    ssl, max: 2, prepare: false, connect_timeout: 5, idle_timeout: 20,
    connection: { statement_timeout: 5000, lock_timeout: 3000, idle_in_transaction_session_timeout: 5000 }
  });
  return new PostgresStore(sql);
}
