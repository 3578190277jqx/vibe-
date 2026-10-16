import { normalizeIp } from './domain.js';

export function loadConfig(env = process.env) {
  if (!env.IP_HASH_SALT || env.IP_HASH_SALT.length < 32) throw new Error('IP_HASH_SALT must contain at least 32 characters');
  const database = env.DATABASE_KIND ?? 'sqlite';
  if (!['sqlite', 'postgres'].includes(database)) throw new Error('DATABASE_KIND must be sqlite or postgres');
  if (env.NODE_ENV === 'production' && database !== 'postgres') throw new Error('Production requires PostgreSQL');
  if (database === 'postgres' && !env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const ssl = env.DATABASE_SSL ?? 'require';
  if (!['require', 'disable'].includes(ssl) || (env.NODE_ENV === 'production' && ssl === 'disable')) throw new Error('DATABASE_SSL must require TLS in production');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const clientIpHeader = (env.CLIENT_IP_HEADER ?? '').toLowerCase();
  const trustedProxyIps = (env.TRUSTED_PROXY_IPS ?? '').split(',').map(s => s.trim()).filter(Boolean).map(normalizeIp);
  if (Boolean(clientIpHeader) !== Boolean(trustedProxyIps.length) || (clientIpHeader && !/^[a-z0-9-]+$/.test(clientIpHeader))) throw new Error('Incomplete proxy configuration');
  return {
    database, filename: env.SQLITE_PATH ?? '.local/aether.sqlite',
    databaseUrl: env.DATABASE_URL, ssl, caFile: env.DATABASE_CA_FILE,
    salt: env.IP_HASH_SALT, host: env.HOST ?? '127.0.0.1', port,
    clientIpHeader, trustedProxyIps
  };
}
