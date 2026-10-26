import { describe, expect, it, vi } from 'vitest';
import { MansaProvider } from '../../src/server/providers/mansa/provider.js';

const KEY = 'mansa_live_sk_test_do_not_log_me';
const NOW = new Date('2026-10-25T10:00:00.000Z');

const EXCHANGES = {
  success: true,
  data: [
    { code: 'NGX', country: 'Nigeria', currency: 'NGN' },
    { code: 'NSE', country: 'Kenya', currency: 'KES' },
    { code: 'JSE', country: 'South Africa', currency: 'ZAR' }
  ],
  meta: { count: 3 }
};

const SCOM = {
  symbol: 'SCOM',
  name: 'Safaricom PLC',
  currency: 'KES',
  previous_close: 12.3,
  close: 12.45,
  change_percentage: 1.22,
  volume: 1_500_000,
  updated_at: '2026-10-25T09:55:00.000Z'
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Routes requests to canned responses and records every URL requested. */
function router(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: URL | string) => {
    const href = String(url);
    calls.push(href);
    for (const [fragment, responder] of Object.entries(overrides)) {
      if (href.includes(fragment)) return responder();
    }
    if (href.includes('/markets/exchanges/NSE/stocks/SCOM')) return json({ success: true, data: SCOM });
    if (href.includes('/markets/exchanges/NSE/stocks'))
      return json({ success: true, data: [SCOM, { ...SCOM, symbol: 'EQTY', close: 48.7 }] });
    if (href.includes('/markets/exchanges/NSE/movers'))
      return json({
        success: true,
        data: {
          gainers: [{ symbol: 'SCOM', close: 12.45, change_percentage: 4.2, updated_at: '2026-10-25T09:55:00.000Z' }],
          losers: [{ symbol: 'EQTY', close: 48.7, change_percentage: -1.1 }]
        }
      });
    if (href.includes('/markets/exchanges')) return json(EXCHANGES);
    if (href.endsWith('/health')) return json({ success: true, data: { status: 'ok' } });
    return json({ success: false, error: { code: 'NOT_FOUND' } }, 404);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function provider(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof MansaProvider>[0]> = {}) {
  return new MansaProvider({
    baseUrl: 'https://mansaapi.com',
    apiKey: KEY,
    fetchImpl,
    now: () => NOW,
    cacheTtlMs: 60_000,
    ...overrides
  });
}

describe('MansaProvider — exchange discovery', () => {
  it('discovers the Kenya exchange code instead of assuming it', async () => {
    const { fetchImpl } = router();
    const mansa = provider(fetchImpl);
    const exchange = await mansa.discoverExchange();
    expect(exchange.code).toBe('NSE');
    expect(exchange.source).toBe('DISCOVERY');
  });

  it('uses the documented exchange code as a labelled fallback when Kenya is absent', async () => {
    const { fetchImpl } = router({
      '/markets/exchanges': () => json({ success: true, data: [{ code: 'NGX', country: 'Nigeria' }] })
    });
    const mansa = provider(fetchImpl);
    const exchange = await mansa.discoverExchange();
    expect(exchange.code).toBe('NSE');
    expect(exchange.source).toBe('DOCUMENTED_FALLBACK');
    expect(exchange.evidence).toMatch(/documented exchange code/);
  });

  it('caches discovery so it costs one request per process', async () => {
    const { fetchImpl, calls } = router();
    const mansa = provider(fetchImpl);
    await mansa.discoverExchange();
    await mansa.discoverExchange();
    expect(calls.filter((url) => url.endsWith('/markets/exchanges'))).toHaveLength(1);
  });
});

describe('MansaProvider — quotes', () => {
  it('returns a normalised KES observation with provider timestamp and delayed mode', async () => {
    const { fetchImpl } = router();
    const mansa = provider(fetchImpl);
    const quote = await mansa.getLatestQuote({ symbol: 'scom' });
    expect(quote).not.toBeNull();
    expect(quote).toMatchObject({
      symbol: 'SCOM',
      price: 12.45,
      currency: 'KES',
      changePercent: 1.22,
      dataMode: 'DELAYED',
      volume: 1_500_000,
      marketEventAt: '2026-10-25T09:55:00.000Z'
    });
    expect(quote?.dataMode).not.toBe('REAL_TIME');
  });

  it('serves repeated quotes from cache so the free-tier quota is respected', async () => {
    const { fetchImpl, calls } = router();
    const mansa = provider(fetchImpl);
    await mansa.getLatestQuote({ symbol: 'SCOM' });
    await mansa.getLatestQuote({ symbol: 'SCOM' });
    expect(calls.filter((url) => url.includes('/stocks/SCOM'))).toHaveLength(1);
  });

  it('answers from a warmed snapshot without an extra per-symbol request', async () => {
    const { fetchImpl, calls } = router();
    const mansa = provider(fetchImpl);
    const count = await mansa.refreshSnapshot();
    expect(count).toBe(2);
    expect(mansa.cachedSnapshotSize()).toBe(2);
    const before = calls.length;
    const quote = await mansa.getLatestQuote({ symbol: 'EQTY' });
    expect(quote).toMatchObject({ symbol: 'EQTY', price: 48.7 });
    expect(calls.length).toBe(before);
  });

  it('returns null and a secret-free reason when the key is rejected', async () => {
    const { fetchImpl } = router({
      '/markets/exchanges': () => json({ success: false, error: { code: 'INVALID_API_KEY' } }, 401)
    });
    const mansa = provider(fetchImpl);
    expect(await mansa.getLatestQuote({ symbol: 'SCOM' })).toBeNull();
    expect(mansa.describeLastFailure()).toContain('AUTH');
    expect(mansa.describeLastFailure()).not.toContain(KEY);
  });

  it('does not fabricate a quote when the provider returns a malformed record', async () => {
    const { fetchImpl } = router({ '/stocks/SCOM': () => json({ success: true, data: { symbol: 'SCOM' } }) });
    const mansa = provider(fetchImpl);
    expect(await mansa.getLatestQuote({ symbol: 'SCOM' })).toBeNull();
    expect(mansa.describeLastFailure()).toMatch(/price/);
  });

  it('rejects a symbol that is not a plausible ticker without a request', async () => {
    const { fetchImpl, calls } = router();
    const mansa = provider(fetchImpl);
    expect(await mansa.getLatestQuote({ symbol: '<script>' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('never sends a request when no key is configured', async () => {
    const { fetchImpl, calls } = router();
    const mansa = provider(fetchImpl, { apiKey: '' });
    expect(await mansa.getLatestQuote({ symbol: 'SCOM' })).toBeNull();
    expect(calls).toHaveLength(0);
    const status = await mansa.status();
    expect(status).toMatchObject({ state: 'UNCONFIGURED', configured: false, dataMode: 'UNKNOWN' });
  });
});

describe('MansaProvider — movers', () => {
  it('parses gainers and losers, leaving missing values null', async () => {
    const { fetchImpl } = router();
    const mansa = provider(fetchImpl);
    const gainers = await mansa.getMovers({ type: 'gainers', limit: 5 });
    expect(gainers?.items[0]).toMatchObject({ symbol: 'SCOM', price: 12.45, changePercent: 4.2, currency: 'KES' });
    const losers = await mansa.getMovers({ type: 'losers', limit: 5 });
    expect(losers?.items[0]).toMatchObject({ symbol: 'EQTY', changePercent: -1.1 });
    expect(losers?.items[0]?.marketEventAt).toBeNull();
  });

  it('returns null rather than an empty success when the request fails', async () => {
    const { fetchImpl } = router({ '/movers': () => json({ success: false }, 500) });
    const mansa = provider(fetchImpl);
    expect(await mansa.getMovers({ type: 'gainers' })).toBeNull();
    expect(mansa.describeLastFailure()).toContain('HTTP');
  });
});

describe('MansaProvider — status is evidence-based', () => {
  it('starts DEGRADED when a key exists but nothing has been verified', async () => {
    const { fetchImpl } = router();
    const mansa = provider(fetchImpl);
    const status = await mansa.status();
    expect(status).toMatchObject({ state: 'DEGRADED', configured: true, lastSuccessAt: null, dataMode: 'UNKNOWN' });
    expect(status.message).toMatch(/no authenticated Mansa response has been verified/i);
  });

  it('becomes READY only after a successful authenticated response', async () => {
    const { fetchImpl } = router();
    const mansa = provider(fetchImpl);
    await mansa.getLatestQuote({ symbol: 'SCOM' });
    const status = await mansa.status();
    expect(status.state).toBe('READY');
    expect(status.configured).toBe(true);
    expect(status.lastSuccessAt).toBe(NOW.toISOString());
    expect(status.message).toMatch(/delayed/i);
    expect(status.message).not.toMatch(/real-time snapshot|live prices/i);
  });

  it('reports ERROR when the only attempt failed', async () => {
    const { fetchImpl } = router({ '/markets/exchanges': () => json({ success: false }, 401) });
    const mansa = provider(fetchImpl);
    await mansa.getLatestQuote({ symbol: 'SCOM' });
    const status = await mansa.status();
    expect(status.state).toBe('ERROR');
    expect(status.message).toContain('AUTH');
    expect(status.message).not.toContain(KEY);
  });

  it('declares DELAYED access and states that the key is not a redistribution licence', () => {
    const mansa = provider(router().fetchImpl);
    const capabilities = mansa.capabilities();
    expect(capabilities.accessLevel).toBe('DELAYED');
    expect(capabilities.demo).toBe(false);
    expect(capabilities.coverage.notes.join(' ')).toMatch(/not an NSE redistribution licence/);
    expect(capabilities.coverage.historyDepth).toMatch(/Pro plan/);
  });
});

describe('MansaProvider — self test', () => {
  it('blocks without a key and makes no network call', async () => {
    const { fetchImpl, calls } = router();
    const mansa = provider(fetchImpl, { apiKey: '' });
    const result = await mansa.selfTest(NOW);
    expect(result.connection.status).toBe('BLOCKED');
    expect(result.connection.networkCallMade).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports what actually happened, including the observed payload keys', async () => {
    const { fetchImpl } = router();
    const mansa = provider(fetchImpl);
    const result = await mansa.selfTest(NOW);
    expect(result.connection.networkCallMade).toBe(true);
    expect(result.connection.status).toBe('PASSED');
    expect(result.dataValidation.status).toBe('PASSED');
    expect(result.dataValidation.checks.map((check) => check.name)).toContain('Stock list payload');
    expect(result.dataValidation.checks.find((check) => check.name === 'Stock list payload')?.detail).toMatch(
      /Record keys observed: .*symbol/
    );
  });

  it('fails the data validation when the payload has no recognisable ticker', async () => {
    const { fetchImpl } = router({
      '/stocks': () => json({ success: true, data: [{ mystery_field: 1 }] })
    });
    const mansa = provider(fetchImpl);
    const result = await mansa.selfTest(NOW);
    expect(result.dataValidation.status).toBe('FAILED');
  });

  it('fails the connection when the authenticated call is rejected', async () => {
    const { fetchImpl } = router({ '/markets/exchanges': () => json({ success: false }, 401) });
    const mansa = provider(fetchImpl);
    const result = await mansa.selfTest(NOW);
    expect(result.connection.status).toBe('FAILED');
    expect(result.connection.summary).toMatch(/At least one connection check failed/);
  });
});

describe('MansaProvider — quota accounting', () => {
  it('exposes usage and refuses to exceed the local budget', async () => {
    const { fetchImpl } = router();
    const mansa = provider(fetchImpl, { dailyRequestBudget: 2 });
    await mansa.getLatestQuote({ symbol: 'SCOM' }); // discovery + quote = 2
    expect(mansa.usage()).toMatchObject({ requestsUsed: 2, dailyRequestBudget: 2 });
    expect(await mansa.getLatestQuote({ symbol: 'EQTY' })).toBeNull();
    expect(mansa.describeLastFailure()).toContain('QUOTA');
  });
});
