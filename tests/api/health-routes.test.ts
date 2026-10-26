import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/api/app.js';
import { closeDatabase } from '../../src/server/db/client.js';

const app = createApp({ quiet: true });

afterAll(async () => {
  await closeDatabase();
});

describe('liveness and readiness endpoints', () => {
  it('serves liveness without depending on the database', async () => {
    const response = await request(app).get('/api/v1/health/live').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', version: '0.1.0', timezone: 'Africa/Nairobi' });
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('serves readiness with per-check detail', async () => {
    const response = await request(app).get('/api/v1/health/ready').expect(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.checks.database.configured).toBe(false);
    expect(response.body.checks.provider.liveQuoteAdapterEnabled).toBe(false);
    expect(['NO_DATA', 'OK', 'STALE', 'UNKNOWN']).toContain(response.body.checks.dataFreshness.status);
  });

  it('keeps the aggregate health endpoint honest about demo and live states', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);
    expect(response.body.demoMode).toBe(false);
    expect(response.body.liveQuoteAdapterEnabled).toBe(false);
    expect(response.body.note).toContain('not evidence of market-data entitlement');
  });
});

describe('request correlation', () => {
  it('returns a generated request id', async () => {
    const response = await request(app).get('/api/v1/docs');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{16,64}$/i);
  });

  it('echoes a well-formed caller request id and replaces a suspicious one', async () => {
    const forwarded = await request(app).get('/api/v1/docs').set('x-request-id', 'abcdef0123456789');
    expect(forwarded.headers['x-request-id']).toBe('abcdef0123456789');
    const replaced = await request(app).get('/api/v1/docs').set('x-request-id', '<script>alert(1)</script>');
    expect(replaced.headers['x-request-id']).not.toBe('<script>alert(1)</script>');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{16,64}$/i);
  });
});
