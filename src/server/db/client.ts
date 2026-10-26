import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { config } from '../config.js';
import { classifyDatabaseError } from './errors.js';

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
export interface DatabaseHealth {
  configured: boolean;
  reachable: boolean;
  message: string;
  /**
   * Whether the application tables exist. `SELECT 1` succeeds against an empty database, so
   * reachability alone is not enough: without this check a never-migrated database reports
   * "healthy" while every data route fails.
   */
  schema: {
    initialised: boolean;
    checkedTable: string;
    message: string;
    hint: string | null;
  };
}

const SENTINEL_TABLE = 'securities';

export async function databaseHealth(): Promise<DatabaseHealth> {
  if (!config.DATABASE_URL)
    return {
      configured: false,
      reachable: false,
      message: 'DATABASE_URL is not configured; persistent market data is unavailable.',
      schema: {
        initialised: false,
        checkedTable: SENTINEL_TABLE,
        message: 'No database is configured, so no schema was checked.',
        hint: null
      }
    };
  try {
    getDatabase();
    await pool!.query('SELECT 1');
  } catch (error) {
    const described = classifyDatabaseError(error);
    return {
      configured: true,
      reachable: false,
      message:
        described.kind === 'AUTH'
          ? 'PostgreSQL rejected the configured credentials; the value is intentionally not exposed.'
          : 'Database connection failed; details are intentionally not exposed.',
      schema: {
        initialised: false,
        checkedTable: SENTINEL_TABLE,
        message: 'Schema could not be checked because the connection failed.',
        hint: described.hint
      }
    };
  }

  try {
    const result = await pool!.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${SENTINEL_TABLE}`]);
    const present = Boolean(result.rows[0]?.present);
    return {
      configured: true,
      reachable: true,
      message: present
        ? 'PostgreSQL connection is healthy.'
        : 'PostgreSQL is reachable, but the application schema has not been created.',
      schema: {
        initialised: present,
        checkedTable: SENTINEL_TABLE,
        message: present
          ? `Table "${SENTINEL_TABLE}" is present, so migrations have been applied.`
          : `Table "${SENTINEL_TABLE}" is missing: no migration has been applied to this database.`,
        hint: present ? null : 'Run `npm run db:migrate` against this database.'
      }
    };
  } catch (error) {
    const described = classifyDatabaseError(error);
    return {
      configured: true,
      reachable: true,
      message: 'PostgreSQL connection is healthy.',
      schema: {
        initialised: false,
        checkedTable: SENTINEL_TABLE,
        message: `Schema could not be verified: ${described.message}`,
        hint: described.hint
      }
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
