import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Quote resolution with a live adapter.
 *
 * These paths used to sit inside a 630-line class and were the least covered part of it.
 * The rules under test are the market-data integrity rules, not formatting: a provider's
 * own answer is never replaced by stored rows, a fallback is always labelled as stored,
 * and a stale or untimestamped value is never described as current.
 */
const state = {
  security: null as null | Record<string, unknown>,
  latest: null as null | Record<string, unknown>
};

vi.mock('../../src/server/db/repository.js', () => ({
  findSecurityBySymbol: vi.fn(async () => state.security),
  latestObservation: vi.fn(async () => state.latest),
  historicalObservations: vi.fn(async () => []),
  searchSecurities: vi.fn(async () => ({ items: [], total: null })),
  counts: vi.fn(async () => ({ securities: 0, observations: 0 })),
  dataSnapshot: vi.fn(),
  listIssuerAnnouncements: vi.fn()
}));

const { MarketService, PROVIDER_QUOTE_NOTICE } = await import('../../src/server/services/market.js');
const { ProviderRegistry } = await import('../../src/server/providers/types.js');
const { ProviderRuntime } = await import('../../src/server/providers/runtime.js');

const security = {
  id: 'sec-1',
  symbol: 'SCOM',
  name: 'Safaricom PLC',
  exchange: 'NSE',
  instrumentType: 'EQUITY',
  listingStatus: 'LISTED',
  sector: 'Telecommunication'
};

type QuoteResult = Awaited<ReturnType<InstanceType<typeof MarketService>['quote']>>;

function providerQuote(overrides: Record<string, unknown> = {}) {
  return {
    securityId: 'sec-1',
    symbol: 'SCOM',
    price: 12.5,
    currency: 'KES' as const,
    source: 'mansa',
    marketEventAt: new Date().toISOString(),
    publishedAt: null,
    ingestedAt: new Date().toISOString(),
    dataMode: 'DELAYED' as const,
    validationStatus: 'VALID' as const,
    ...overrides
  };
}

/** A live adapter whose answer (or failure) each test decides. */
function liveRegistry(
  quote: unknown | null,
  options: { failure?: string | null } = {}
): InstanceType<typeof ProviderRegistry> {
  const provider = {
    id: 'mansa',
    live: true,
    demo: false,
    status: vi.fn(),
    capabilities: vi.fn(),
    getLatestQuote: vi.fn(async () => quote),
    getHistory: vi.fn(async () => []),
    selfTest: vi.fn(),
    describeLastFailure: vi.fn(() => options.failure ?? null)
  };
  return new ProviderRegistry([provider as never]);
}

function service(registry: InstanceType<typeof ProviderRegistry>) {
  return new MarketService(registry, { runtime: new ProviderRuntime() });
}

beforeEach(() => {
  state.security = null;
  state.latest = null;
});

describe('quote with a live adapter', () => {
  it("returns the provider's own observation and labels it as a provider snapshot", async () => {
    state.security = security;
    const result: QuoteResult = await service(liveRegistry(providerQuote())).quote('SCOM');

    expect(result.observation?.price).toBe(12.5);
    expect(result.observation?.stale).toBe(false);
    expect(result.provenance?.kind).toBe('PROVIDER_QUOTE');
    expect(result.provenance?.liveQuoteAdapterEnabled).toBe(true);
    expect(result.provenance?.dataMode).toBe('DELAYED');
    expect(result.warnings?.[0]).toBe(PROVIDER_QUOTE_NOTICE);
    // The notice must not describe delayed data as real-time.
    expect(PROVIDER_QUOTE_NOTICE).toContain('not real-time');
  });

  it('keeps the provider identity when the symbol is missing from the security master', async () => {
    // No stored security row: identity comes from the provider record and the response says so
    // instead of silently inventing a name.
    const result = await service(liveRegistry(providerQuote())).quote('SCOM');

    expect(result.security?.id).toBe('sec-1');
    expect(result.security?.exchange).toBe('NSE');
    expect(result.warnings?.join(' ')).toContain('not in the configured security master');
  });

  it('marks a provider snapshot without a timestamp as stale and says freshness cannot be asserted', async () => {
    state.security = security;
    const result = await service(liveRegistry(providerQuote({ marketEventAt: null }))).quote('SCOM');

    expect(result.observation?.stale).toBe(true);
    expect(result.provenance?.freshnessNote).toContain('no observation timestamp');
    expect(result.warnings?.join(' ')).toContain('freshness cannot be asserted');
    expect(result.warnings?.join(' ')).not.toContain('older than 24 hours');
  });

  it('marks an old provider snapshot as stale', async () => {
    state.security = security;
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const result = await service(liveRegistry(providerQuote({ marketEventAt: twoDaysAgo }))).quote('SCOM');

    expect(result.observation?.stale).toBe(true);
    expect(result.provenance?.freshnessNote).toContain('stale');
  });

  it('falls back to a stored observation and labels it as stored, not as the provider quote', async () => {
    state.security = security;
    state.latest = {
      securityId: 'sec-1',
      symbol: 'SCOM',
      price: '11.000000',
      open: '10.500000',
      high: null,
      low: null,
      previousClose: '10.750000',
      turnover: '1000000',
      volume: 5000,
      source: 'import',
      dataMode: 'EOD',
      marketEventAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    };

    const result = await service(liveRegistry(null, { failure: 'provider timed out' })).quote('SCOM');

    expect(result.provenance?.kind).toBe('STORED_OBSERVATION');
    expect(result.provenance?.liveQuoteAdapterEnabled).toBe(false);
    expect(result.observation?.price).toBe(11);
    expect(result.observation?.stale).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.warnings?.join(' ')).toContain('stored observation, not a current provider quote');
    expect(result.warnings?.join(' ')).toContain('provider timed out');
  });

  it('reports no quote when the provider fails and nothing is stored', async () => {
    state.security = security;
    const result = await service(liveRegistry(null, { failure: 'upstream 503' })).quote('SCOM');

    expect(result.observation).toBeNull();
    expect(result.provenance).toBeNull();
    expect(result.reason).toContain('upstream 503');
    // Even a failure response carries the provider notice rather than implying a live price.
    expect(result.warnings?.[0]).toBe(PROVIDER_QUOTE_NOTICE);
  });

  it('uses the generic failure wording when the adapter offers no reason', async () => {
    state.security = security;
    const result = await service(liveRegistry(null)).quote('SCOM');
    expect(result.reason).toContain('returned no quote for this symbol');
  });
});

describe('quote with stored data only', () => {
  it('returns the stored observation with its stored source and mode', async () => {
    state.security = security;
    state.latest = {
      securityId: 'sec-1',
      symbol: 'SCOM',
      price: '12.000000',
      open: null,
      high: '12.500000',
      low: '11.750000',
      previousClose: null,
      turnover: null,
      volume: 900,
      source: 'import',
      dataMode: 'EOD',
      marketEventAt: new Date()
    };

    const result = await service(new ProviderRegistry()).quote('SCOM');

    expect(result.observation?.price).toBe(12);
    expect(result.observation?.high).toBe(12.5);
    expect(result.provenance?.kind).toBe('STORED_OBSERVATION');
    expect(result.provenance?.source).toBe('import');
    expect(result.observation?.stale).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('explains a missing security instead of returning an empty quote object', async () => {
    const result = await service(new ProviderRegistry()).quote('NOPE');
    expect(result.reason).toContain('not found in the configured security master');
    expect(result.provenance).toBeNull();
  });

  it('explains a security that has no observations yet', async () => {
    state.security = security;
    const result = await service(new ProviderRegistry()).quote('SCOM');
    expect(result.reason).toBe('No verified market observations are available.');
  });
});
