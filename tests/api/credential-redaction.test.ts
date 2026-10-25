import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Set credential-looking values before the configuration module is imported so the
 * test exercises the real environment path and proves values never reach a response.
 */
const SECRET_KEY = 'test-secret-key-value-9f4b2c';
const BASE_URL = 'https://vendor.example.invalid/api/v9';
process.env.MARKET_DATA_PROVIDER = 'nse-vendor';
process.env.NSE_VENDOR_API_BASE_URL = BASE_URL;
process.env.NSE_VENDOR_API_KEY = SECRET_KEY;

const { createApp } = await import('../../src/server/api/app.js');
const { closeDatabase } = await import('../../src/server/db/client.js');
const app = createApp();

afterAll(async () => {
  delete process.env.MARKET_DATA_PROVIDER;
  delete process.env.NSE_VENDOR_API_BASE_URL;
  delete process.env.NSE_VENDOR_API_KEY;
  await closeDatabase();
});

describe('credential redaction', () => {
  it('reports configured credentials without exposing their values', async () => {
    const response = await request(app).get('/api/v1/providers/configuration').expect(200);
    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(SECRET_KEY);
    expect(serialised).not.toContain(BASE_URL);
    const credentials = response.body.credentials as { key: string; state: string; secret: boolean }[];
    expect(credentials.find((credential) => credential.key === 'NSE_VENDOR_API_KEY')?.state).toBe('CONFIGURED');
    expect(credentials.find((credential) => credential.key === 'NSE_VENDOR_API_BASE_URL')?.state).toBe('CONFIGURED');
    expect(credentials.find((credential) => credential.key === 'NSE_VENDOR_API_KEY')?.secret).toBe(true);
  });

  it('still refuses to treat credential presence as a working integration', async () => {
    const response = await request(app).get('/api/v1/providers/configuration').expect(200);
    expect(response.body.provider.integrationStatus).toBe('UNCONFIGURED');
    expect(response.body.environment.liveQuoteAdapterEnabled).toBe(false);
    expect(response.body.access.level).toBe('UNKNOWN');
    expect(response.body.coverage.state).toBe('NOT_DECLARED');
    const tested = await request(app).post('/api/v1/providers/test').expect(200);
    expect(tested.body.configuration.tests.connection.networkCallMade).toBe(false);
    expect(tested.body.configuration.tests.connection.status).toBe('BLOCKED');
    expect(JSON.stringify(tested.body)).not.toContain(SECRET_KEY);
  });
});
