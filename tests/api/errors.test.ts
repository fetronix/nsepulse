import { afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Error handling and input validation. The repository is forced to fail so the generic
 * 500 handler is exercised, and malformed queries are checked per route.
 */
vi.mock('../../src/server/db/repository.js', () => ({
  counts: vi.fn(async () => {
    throw new Error('database exploded with a secret connection string postgres://user:pw@host/db');
  }),
  searchSecurities: vi.fn(async () => {
    throw new Error('query failure');
  }),
  findSecurityBySymbol: vi.fn(async () => {
    throw new Error('query failure');
  }),
  latestObservation: vi.fn(),
  historicalObservations: vi.fn(async () => {
    throw new Error('query failure');
  }),
  dataSnapshot: vi.fn(async () => {
    throw new Error('query failure');
  }),
  listIssuerAnnouncements: vi.fn(async () => {
    throw new Error('query failure');
  })
}));

const { createApp } = await import('../../src/server/api/app.js');
const { closeDatabase } = await import('../../src/server/db/client.js');
const app = createApp();

afterAll(async () => {
  await closeDatabase();
});

describe('generic error handling', () => {
  it('returns a safe 500 without leaking internal details', async () => {
    const response = await request(app).get('/api/v1/market/overview').expect(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toContain('postgres://');
    expect(JSON.stringify(response.body)).not.toContain('database exploded');
  });

  it('keeps the same safe shape for query and provider failures', async () => {
    for (const path of [
      '/api/v1/securities',
      '/api/v1/quotes/SCOM',
      '/api/v1/technicals/SCOM',
      '/api/v1/data-sources'
    ]) {
      const response = await request(app).get(path).expect(500);
      expect(response.body).toEqual({ error: 'Internal server error' });
    }
  });
});

describe('input validation', () => {
  it('rejects invalid pagination', async () => {
    await request(app).get('/api/v1/securities?limit=0').expect(400);
    await request(app).get('/api/v1/securities?limit=101').expect(400);
    await request(app).get('/api/v1/securities?offset=-1').expect(400);
    await request(app)
      .get('/api/v1/securities?q=' + 'a'.repeat(101))
      .expect(400);
  });

  it('rejects malformed symbols on every symbol route', async () => {
    await request(app)
      .get('/api/v1/quotes/' + 'x'.repeat(25))
      .expect(400);
    await request(app).get('/api/v1/technicals/%3Cscript%3E').expect(400);
    await request(app).get('/api/v1/history/%3Cscript%3E').expect(400);
  });

  it('rejects an inverted history range and invalid dates', async () => {
    await request(app).get('/api/v1/history/SCOM?from=2026-10-26&to=2026-10-25').expect(400);
    await request(app).get('/api/v1/history/SCOM?from=not-a-date').expect(400);
  });

  it('rejects an invalid announcement limit', async () => {
    await request(app).get('/api/v1/announcements?limit=0').expect(400);
    await request(app).get('/api/v1/announcements?limit=51').expect(400);
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(response.body).toEqual({ error: 'API route not found' });
  });
});

describe('security headers', () => {
  it('sets helmet headers and disables x-powered-by', async () => {
    const response = await request(app).get('/api/v1/docs');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
  });
});
