import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/api/app.js';
import { closeDatabase } from '../../src/server/db/client.js';

const app = createApp();
afterAll(async () => closeDatabase());

describe('provider configuration endpoints', () => {
  it('reports the disabled adapter without claiming market-data access', async () => {
    const response = await request(app).get('/api/v1/providers/configuration').expect(200);
    const body = response.body;
    expect(body.provider.id).toBe('nse-authorized-feed');
    expect(body.provider.demo).toBe(false);
    expect(body.provider.integrationStatus).toBe('UNCONFIGURED');
    expect(body.environment.liveQuoteAdapterEnabled).toBe(false);
    expect(body.access.level).toBe('UNKNOWN');
    expect(body.access.entitlement).toBe('NONE');
    expect(body.coverage.state).toBe('NOT_DECLARED');
    expect(body.credentials.length).toBe(2);
    expect(body.credentials.every((credential: { state: string }) => credential.state === 'MISSING')).toBe(true);
    expect(body.retrieval.lastSuccessfulRetrievalAt).toBeNull();
    expect(body.tests.connection.status).toBe('NOT_RUN');
    expect(body.tests.dataValidation.status).toBe('NOT_RUN');
    expect(body.licensing.length).toBeGreaterThan(3);
    expect(JSON.stringify(body)).not.toContain('API_KEY=');
  });

  it('runs local tests only and reports them as blocked', async () => {
    const response = await request(app).post('/api/v1/providers/test').expect(200);
    expect(response.body.networkAccessAttempted).toBe(false);
    expect(response.body.configuration.tests.connection.status).toBe('BLOCKED');
    expect(response.body.configuration.tests.connection.networkCallMade).toBe(false);
    expect(response.body.configuration.tests.dataValidation.status).toBe('BLOCKED');
    expect(response.body.configuration.environment.liveQuoteAdapterEnabled).toBe(false);
  });

  it('lists independent sources with explicit permissions and freshness', async () => {
    const response = await request(app).get('/api/v1/data-sources').expect(200);
    const items = response.body.items as { id: string; independentOfLiveQuoteAdapter: boolean; permission: { status: string }; freshness: { label: string } }[];
    const historical = items.find((item) => item.id === 'historical-eod');
    const announcements = items.find((item) => item.id === 'issuer-announcements');
    const live = items.find((item) => item.id === 'live-quotes');
    expect(historical?.independentOfLiveQuoteAdapter).toBe(true);
    expect(historical?.freshness.label).toBe('END_OF_DAY');
    expect(historical?.permission.status).toBe('UNCONFIRMED');
    expect(announcements?.independentOfLiveQuoteAdapter).toBe(true);
    expect(announcements?.freshness.label).toBe('AS_PUBLISHED');
    expect(live?.independentOfLiveQuoteAdapter).toBe(false);
    expect(live?.permission.status).toBe('NOT_REQUESTED');
    expect(response.body.notes.join(' ')).toContain('permission');
  });

  it('serves no announcements without recorded permission', async () => {
    const response = await request(app).get('/api/v1/announcements').expect(200);
    expect(response.body.state).toBe('PERMISSION_UNCONFIRMED');
    expect(response.body.items).toEqual([]);
    expect(response.body.permission.status).toBe('UNCONFIRMED');
    expect(response.body.freshness.label).toBe('AS_PUBLISHED');
  });

  it('labels stored quotes honestly when the adapter is disabled', async () => {
    const overview = await request(app).get('/api/v1/market/overview').expect(200);
    expect(overview.body.dataPolicy.liveQuoteAdapterEnabled).toBe(false);
    expect(overview.body.dataPolicy.demoMode).toBe(false);
    expect(overview.body.dataPolicy.demoNotice).toBeNull();
    const quote = await request(app).get('/api/v1/quotes/SCOM').expect(404);
    expect(quote.body.observation).toBeNull();
    expect(quote.body.provenance).toBeNull();
  });
});
