import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

let pool: Pool | null = null;
let database: NodePgDatabase<typeof schema> | null = null;
export function getDatabase(): NodePgDatabase<typeof schema> | null {
  if (!config.DATABASE_URL) return null;
  if (!database) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
    database = drizzle(pool, { schema });
  }
  return database;
}
export async function databaseHealth(): Promise<{ configured: boolean; reachable: boolean; message: string }> {
  if (!config.DATABASE_URL)
    return {
      configured: false,
      reachable: false,
      message: 'DATABASE_URL is not configured; persistent market data is unavailable.'
    };
  try {
    getDatabase();
    await pool!.query('SELECT 1');
    return { configured: true, reachable: true, message: 'PostgreSQL connection is healthy.' };
  } catch {
    return {
      configured: true,
      reachable: false,
      message: 'Database connection failed; details are intentionally not exposed.'
    };
  }
}
export async function withAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T | null> {
  getDatabase();
  if (!pool) return null;
  const connection = await pool.connect();
  try {
    const result = await connection.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!result.rows[0]?.locked) return null;
    try {
      return await work();
    } finally {
      await connection.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    connection.release();
  }
}
/**
 * Take a session-level advisory lock and hold it until the returned function is called.
 *
 * Used to guarantee a single long-polling process across restarts and replicas: a second
 * instance gets `null` instead of opening a competing Telegram `getUpdates` loop. The lock
 * is owned by one dedicated pooled connection, which is released with it.
 */
export async function tryAcquireProcessLock(key: number): Promise<(() => Promise<void>) | null> {
  getDatabase();
  if (!pool) return null;
  const connection = await pool.connect();
  try {
    const result = await connection.query('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!result.rows[0]?.locked) {
      connection.release();
      return null;
    }
  } catch (error) {
    connection.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await connection.query('SELECT pg_advisory_unlock($1)', [key]);
    } finally {
      connection.release();
    }
  };
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
  database = null;
}
