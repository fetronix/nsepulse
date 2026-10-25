import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * A reachable-but-unmigrated database is a deployment problem, not an application bug. The API
 * must say so instead of returning an unexplained 500 — this is the exact failure a first-time
 * `npm run dev` produced before the error handler walked the driver `cause` chain.
 */
function missingTable(sql: string): Error {
  const error = new Error(`Failed query: ${sql}\nparams: `) as Error & { cause?: unknown };
  error.cause = { name: 'error', code: '42P01', message: 'relation "securities" does not exist' };
  return error;
}

vi.mock('../../src/server/db/repository.js', () => ({
  counts: vi.fn(async () => {
    throw missingTable('select count(*) from "securities"');
  }),
  searchSecurities: vi.fn(async () => {
    throw missingTable('select "symbol" from "securities"');
  }),
  findSecurityBySymbol: vi.fn(async () => {
    throw missingTable('select "symbol" from "securities"');
  }),
  latestObservation: vi.fn(async () => null),
  historicalObservations: vi.fn(async () => {
    throw missingTable('select * from "historical_observations"');
  }),
  dataSnapshot: vi.fn(async () => {
    throw missingTable('select 1 from "securities"');
  }),
  listIssuerAnnouncements: vi.fn(async () => {
    throw missingTable('select * from "issuer_announcements"');
  })
}));

const { createApp } = await import('../../src/server/api/app.js');
const { closeDatabase } = await import('../../src/server/db/client.js');
const app = createApp();

afterAll(async () => {
  await closeDatabase();
});

describe('uninitialised database', () => {
  it('answers data routes with 503 and an actionable hint', async () => {
    const response = await request(app).get('/api/v1/securities').expect(503);
    expect(response.body).toMatchObject({
      error: 'The database schema is not initialised',
      detail: 'relation "securities" does not exist',
      hint: expect.stringContaining('npm run db:migrate')
    });
    expect(response.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the market overview usable and labels the missing schema', async () => {
    const response = await request(app).get('/api/v1/market/overview').expect(200);
    expect(response.body.counts).toEqual({ securities: null, observations: null });
    expect(response.body.database).toMatchObject({
      state: 'SCHEMA_MISSING',
      message: 'relation "securities" does not exist',
      hint: expect.stringContaining('npm run db:migrate')
    });
    // Nothing is invented: no indices, no breadth, and freshness is explicitly absent.
    expect(response.body.indices).toEqual([]);
    expect(response.body.breadth).toBeNull();
    expect(response.body.dataFreshness).toEqual({ latestObservationAt: null, status: 'NO_DATA' });
  });

  it('never echoes SQL, table internals or credentials in the response body', async () => {
    for (const path of ['/api/v1/securities', '/api/v1/quotes/SCOM', '/api/v1/market/overview']) {
      const body = JSON.stringify((await request(app).get(path)).body);
      expect(body).not.toContain('Failed query');
      expect(body).not.toContain('postgres://');
      expect(body).not.toContain('password');
    }
  });
});
