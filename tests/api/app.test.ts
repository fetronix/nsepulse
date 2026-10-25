import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/api/app.js';
import { closeDatabase } from '../../src/server/db/client.js';
const app = createApp();
afterAll(async () => closeDatabase());
describe('REST API honest empty states', () => {
  it('exposes health and provider configuration without secrets', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);
    expect(response.body.timezone).toBe('Africa/Nairobi');
    expect(response.body.providers[0].state).toBe('UNCONFIGURED');
    expect(JSON.stringify(response.body)).not.toContain('API_KEY');
  });
  it('returns an empty market overview rather than seeded prices', async () => {
    const response = await request(app).get('/api/v1/market/overview').expect(200);
    expect(response.body.indices).toEqual([]);
    expect(response.body.dataFreshness.status).toBe('NO_DATA');
  });
  it('validates symbols and unknown securities', async () => {
    await request(app).get('/api/v1/quotes/%3Cscript%3E').expect(400);
    const response = await request(app).get('/api/v1/quotes/SCOM').expect(404);
    expect(response.body.observation).toBeNull();
  });
  it('serves OpenAPI and rejects invalid ranges', async () => {
    expect((await request(app).get('/api/v1/docs').expect(200)).body.openapi).toBe('3.1.0');
    await request(app).get('/api/v1/history/SCOM?from=2026-10-26&to=2026-10-25').expect(400);
  });
});
