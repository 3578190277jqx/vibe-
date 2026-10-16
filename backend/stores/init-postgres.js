import { readFile } from 'node:fs/promises';

// The standalone SQL includes BEGIN/COMMIT: pin it to a single connection.
export async function initializePostgres(sql) {
  const connection = await sql.reserve();
  try {
    const script = await readFile(new URL('../sql/postgres.sql', import.meta.url), 'utf8');
    await connection.unsafe(script);
  } catch (error) {
    await connection`ROLLBACK`;
    throw error;
  } finally {
    connection.release();
  }
}
