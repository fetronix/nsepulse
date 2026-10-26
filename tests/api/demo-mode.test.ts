import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/api/app.js';
import { closeDatabase } from '../../src/server/db/client.js';
import { createProviderSelection } from '../../src/server/providers/factory.js';
import { DEFAULT_PROVIDER_SETTINGS } from '../../src/server/providers/settings.js';

const selection = createProviderSelection({
  ...DEFAULT_PROVIDER_SETTINGS,
  provider: 'demo',
  allowDemoData: true,
  nodeEnv: 'development'
});
const app = createApp({ selection });
afterAll(async () => closeDatabase());

const DEMO_SOURCE = 'DEMO FIXTURE';

describe('development demo mode', () => {
  it('marks health and overview as demo without claiming a live adapter', async () => {
    const health = await request(app).get('/api/v1/health').expect(200);
    expect(health.body.demoMode).toBe(true);
    expect(health.body.liveQuoteAdapterEnabled).toBe(false);
    const overview = await request(app).get('/api/v1/market/overview').expect(200);
    expect(overview.body.dataPolicy.demoMode).toBe(true);
    expect(overview.body.dataPolicy.liveQuoteAdapterEnabled).toBe(false);
    expect(overview.body.dataPolicy.demoNotice).toContain('not NSE market data');
    expect(overview.body.indices).toEqual([]);
  });

  it('labels demo quotes as synthetic with UNKNOWN data mode', async () => {
    const response = await request(app).get('/api/v1/quotes/SCOM').expect(200);
    expect(response.body.security.demo).toBe(true);
    expect(response.body.observation.demo).toBe(true);
    expect(response.body.observation.dataMode).toBe('UNKNOWN');
    expect(response.body.observation.source).toContain(DEMO_SOURCE);
    expect(response.body.provenance.kind).toBe('DEMO_FIXTURE');
    expect(response.body.provenance.liveQuoteAdapterEnabled).toBe(false);
    expect(response.body.warnings.join(' ')).toContain('not NSE market data');
  });

  it('lists only labelled demo fixtures in the security directory', async () => {
    const response = await request(app).get('/api/v1/securities').expect(200);
    expect(response.body.demo).toBe(true);
    expect(response.body.items.length).toBe(3);
    expect(
      response.body.items.every(
        (item: { instrumentType: string; listingStatus: string }) =>
          item.instrumentType === 'DEMO_FIXTURE' && item.listingStatus === 'DEMO_ONLY'
      )
    ).toBe(true);
    expect(response.body.note).toContain('synthetic');
    const filtered = await request(app).get('/api/v1/securities?q=EQTY').expect(200);
    expect(filtered.body.items.map((item: { symbol: string }) => item.symbol)).toEqual(['EQTY']);
  });

  it('refuses to invent securities outside the demo fixtures', async () => {
    const response = await request(app).get('/api/v1/quotes/NOTINMASTER').expect(404);
    expect(response.body.security).toBeNull();
    expect(response.body.observation).toBeNull();
    expect(response.body.reason).toContain('demo fixtures');
  });

  it('serves demo history and technicals with explicit demo provenance', async () => {
    const history = await request(app).get('/api/v1/history/SCOM').expect(200);
    expect(history.body.items.length).toBeGreaterThan(0);
    expect(
      history.body.items.every(
        (item: { demo: boolean; source: string }) => item.demo && item.source.includes(DEMO_SOURCE)
      )
    ).toBe(true);
    expect(history.body.provenance.kind).toBe('DEMO_FIXTURE');
    const technicals = await request(app).get('/api/v1/technicals/SCOM').expect(200);
    expect(technicals.body.observationCount).toBe(8);
    expect(technicals.body.provenance.kind).toBe('DEMO_FIXTURE');
    expect(technicals.body.warnings.join(' ')).toContain('Demo fixture data');
  });

  it('shows fixture coverage, no access level and passed synthetic validation', async () => {
    const configuration = await request(app).get('/api/v1/providers/configuration').expect(200);
    expect(configuration.body.provider.demo).toBe(true);
    expect(configuration.body.access.level).toBe('UNKNOWN');
    expect(configuration.body.access.entitlement).toBe('DEMO_FIXTURE');
    expect(configuration.body.coverage.state).toBe('FIXTURE_ONLY');
    expect(configuration.body.environment.liveQuoteAdapterEnabled).toBe(false);
    const tested = await request(app).post('/api/v1/providers/test').expect(200);
    expect(tested.body.networkAccessAttempted).toBe(false);
    expect(tested.body.configuration.tests.connection.status).toBe('NOT_APPLICABLE');
    expect(tested.body.configuration.tests.dataValidation.status).toBe('PASSED');
    const sources = await request(app).get('/api/v1/data-sources').expect(200);
    const live = (sources.body.items as { id: string; availability: { state: string } }[]).find(
      (item) => item.id === 'live-quotes'
    );
    expect(live?.availability.state).toBe('DISABLED');
  });
});
