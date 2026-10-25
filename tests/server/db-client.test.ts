import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The database client reads configuration at import time, so each scenario re-imports
 * the module with a fresh module registry and a controlled DATABASE_URL.
 */
const ORIGINAL_URL = process.env.DATABASE_URL;

async function loadClient(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../src/server/db/client.js');
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_SSL;
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_URL;
  delete process.env.DATABASE_SSL;
  vi.resetModules();
});

describe('database client without configuration', () => {
  it('reports an unconfigured database instead of throwing', async () => {
    const client = await loadClient({ DATABASE_URL: undefined });
    expect(client.getDatabase()).toBeNull();
    const health = await client.databaseHealth();
    expect(health).toEqual({
      configured: false,
      reachable: false,
      message: 'DATABASE_URL is not configured; persistent market data is unavailable.',
      schema: {
        initialised: false,
        checkedTable: 'securities',
        message: 'No database is configured, so no schema was checked.',
        hint: null
      }
    });
  });

  it('returns null from withAdvisoryLock and tolerates closeDatabase', async () => {
    const client = await loadClient({ DATABASE_URL: undefined });
    await expect(client.withAdvisoryLock(1, async () => 'work')).resolves.toBeNull();
    await expect(client.closeDatabase()).resolves.toBeUndefined();
  });
});

describe('database client with configuration', () => {
  it('caches the pool and reports a safe error when the server is unreachable', async () => {
    const client = await loadClient({ DATABASE_URL: 'postgres://user:secret@127.0.0.1:1/nse_test' });
    const database = client.getDatabase();
    expect(database).not.toBeNull();
    expect(client.getDatabase()).toBe(database);
    const health = await client.databaseHealth();
    expect(health.configured).toBe(true);
    expect(health.reachable).toBe(false);
    expect(health.message).toBe('Database connection failed; details are intentionally not exposed.');
    expect(health.schema.initialised).toBe(false);
    expect(health.schema.hint).toMatch(/PostgreSQL is not accepting connections/);
    expect(JSON.stringify(health)).not.toContain('secret');
    await client.closeDatabase();
    // A closed client is re-created lazily on the next request rather than left broken.
    expect(client.getDatabase()).not.toBe(database);
  });
});
