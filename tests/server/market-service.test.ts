import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MarketService provenance, freshness and provenance-labelling behaviour with a stubbed
 * repository. No network or database is used, and no price is asserted to be live.
 */
const state = {
  security: null as null | Record<string, unknown>,
  latest: null as null | Record<string, unknown>,
  history: [] as Record<string, unknown>[]
};

vi.mock('../../src/server/db/repository.js', () => ({
  findSecurityBySymbol: vi.fn(async () => state.security),
  latestObservation: vi.fn(async () => state.latest),
  historicalObservations: vi.fn(async () => state.history),
  searchSecurities: vi.fn(async () => ({ items: [], total: null })),
  counts: vi.fn(async () => ({ securities: 1, observations: 1 })),
  dataSnapshot: vi.fn(),
  listIssuerAnnouncements: vi.fn()
}));

const { MarketService, DEMO_NOTICE } = await import('../../src/server/services/market.js');
const { ProviderRegistry } = await import('../../src/server/providers/types.js');
const { createProviderSelection } = await import('../../src/server/providers/factory.js');
const { DEFAULT_PROVIDER_SETTINGS } = await import('../../src/server/providers/settings.js');

const security = {
  id: 'sec-1',
  symbol: 'SCOM',
  name: 'Safaricom PLC',
  exchange: 'NSE',
  instrumentType: 'EQUITY',
  listingStatus: 'LISTED',
  sector: 'Telecommunication'
};

function storedService() {
  return new MarketService(new ProviderRegistry(), { historicalPermissionConfirmed: true });
}

beforeEach(() => {
  state.security = null;
  state.latest = null;
  state.history = [];
});

describe('overview', () => {
  it('states the no-data policy when the adapter is disabled', async () => {
    const overview = await new MarketService(new ProviderRegistry()).overview();
    expect(overview.dataPolicy.liveQuoteAdapterEnabled).toBe(false);
    expect(overview.dataPolicy.demoMode).toBe(false);
    expect(overview.dataPolicy.demoNotice).toBeNull();
    expect(overview.indices).toEqual([]);
    expect(overview.dataFreshness.status).toBe('NO_DATA');
    expect(overview.dataPolicy.sourceLabels.quotes).toContain('no live feed');
  });

  it('stops claiming there is no live feed once a live adapter is ready', async () => {
    // A configured-but-unproven adapter must not be described as live, and a proven one must
    // not keep the "no live feed" label: the label follows observed state, not configuration.
    const selection = createProviderSelection(
      { ...DEFAULT_PROVIDER_SETTINGS, provider: 'mansa' },
      { mansaCredentials: { baseUrl: 'https://mansaapi.com', apiKey: 'test-key-not-real' } }
    );
    const registry = selection.registry;
    vi.spyOn(registry, 'statuses').mockResolvedValue([
      {
        provider: 'mansa',
        configured: true,
        state: 'READY',
        message: 'Authenticated call succeeded.',
        lastSuccessAt: new Date().toISOString(),
        dataMode: 'DELAYED'
      }
    ]);
    const overview = await new MarketService(registry).overview();
    expect(overview.dataPolicy.liveQuoteAdapterEnabled).toBe(true);
    expect(overview.dataPolicy.sourceLabels.quotes).toContain('fetched live');
    expect(overview.dataPolicy.sourceLabels.quotes).not.toContain('no live feed');
  });

  it('labels demo mode explicitly', async () => {
    const selection = createProviderSelection({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true });
    const overview = await new MarketService(selection.registry).overview();
    expect(overview.dataPolicy.demoMode).toBe(true);
    expect(overview.dataPolicy.demoNotice).toBe(DEMO_NOTICE);
    expect(overview.dataPolicy.sourceLabels.quotes).toContain('DEMO FIXTURE');
  });
});

describe('stored quotes', () => {
  it('returns an unavailable reason when the symbol is unknown', async () => {
    const result = await storedService().quote('SCOM');
    expect(result).toMatchObject({ security: null, observation: null, provenance: null });
    expect(result.reason).toContain('Security not found');
  });

  it('returns an unavailable reason when no observations exist', async () => {
    state.security = security;
    const result = await storedService().quote('SCOM');
    expect(result.observation).toBeNull();
    expect(result.reason).toContain('No verified market observations');
  });

  it('reports a fresh stored observation with provenance and freshness notes', async () => {
    state.security = security;
    state.latest = {
      price: '12.500000',
      open: '12.000000',
      high: '12.800000',
      low: '11.900000',
      previousClose: '12.100000',
      volume: 1500,
      turnover: '18500.0000',
      source: 'reviewed-eod-import',
      dataMode: 'END_OF_DAY',
      marketEventAt: new Date(Date.now() - 60 * 60 * 1000),
      ingestedAt: new Date()
    };
    const result = await storedService().quote('SCOM');
    expect(result.observation).toMatchObject({
      price: 12.5,
      open: 12,
      high: 12.8,
      low: 11.9,
      previousClose: 12.1,
      turnover: 18500,
      stale: false
    });
    expect(result.provenance?.kind).toBe('STORED_OBSERVATION');
    expect(result.provenance?.liveQuoteAdapterEnabled).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('marks a stale observation and explains why', async () => {
    state.security = security;
    state.latest = {
      price: '9.000000',
      source: 'reviewed-eod-import',
      dataMode: 'END_OF_DAY',
      marketEventAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      ingestedAt: new Date()
    };
    const result = await storedService().quote('SCOM');
    expect(result.observation?.stale).toBe(true);
    expect(result.warnings[0]).toContain('stale');
    expect(result.provenance?.freshnessNote).toContain('older than 24 hours');
  });

  it('treats a missing market timestamp as stale rather than live', async () => {
    state.security = security;
    state.latest = { price: '9.000000', source: 'reviewed-eod-import', dataMode: 'UNKNOWN', marketEventAt: null };
    const result = await storedService().quote('SCOM');
    expect(result.observation?.stale).toBe(true);
    expect(result.observation?.marketEventAt).toBeNull();
  });
});

describe('stored history', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-12-31T00:00:00.000Z');

  it('returns an unavailable reason for unknown securities', async () => {
    const result = await storedService().history('NOPE', from, to);
    expect(result).toMatchObject({ security: null, items: [] });
  });

  it('returns an empty series with a reason when nothing is stored', async () => {
    state.security = security;
    const result = await storedService().history('SCOM', from, to);
    expect(result.items).toEqual([]);
    expect(result.reason).toContain('No historical observations');
    expect(result.provenance).toBeNull();
  });

  it('maps stored rows and describes the series end and adjustment state', async () => {
    state.security = security;
    state.history = [
      {
        sessionDate: new Date('2026-10-20T00:00:00.000Z'),
        open: '10.000000',
        high: '10.500000',
        low: '9.500000',
        close: '10.250000',
        volume: 900,
        source: 'reviewed-eod-import',
        dataMode: 'END_OF_DAY',
        adjustedForCorporateActions: true
      }
    ];
    const result = await storedService().history('SCOM', from, to);
    expect(result.items[0]).toMatchObject({ close: 10.25, open: 10, high: 10.5, low: 9.5, volume: 900 });
    expect(result.provenance?.freshnessNote).toContain('adjusted for corporate actions: yes');
    expect(result.warnings?.[0]).toContain('independently of the live quote adapter');
  });
});

describe('technicals', () => {
  it('explains insufficient stored data instead of returning fabricated values', async () => {
    state.security = security;
    state.history = [
      {
        sessionDate: new Date('2026-10-20T00:00:00.000Z'),
        open: '0',
        high: null,
        low: null,
        close: '0',
        volume: null,
        source: 'reviewed-eod-import',
        dataMode: 'END_OF_DAY'
      }
    ];
    const result = await storedService().technicals('SCOM');
    expect(result.items).toEqual([]);
    expect(result.reason).toContain('No historical observations');
  });

  it('computes indicators and nulls those needing more history', async () => {
    state.security = security;
    state.history = Array.from({ length: 30 }, (_, index) => ({
      sessionDate: new Date(2026, 8, index + 1),
      open: '10',
      high: String(11 + index / 100),
      low: '9',
      close: String(10 + index / 100),
      volume: 500,
      source: 'reviewed-eod-import',
      dataMode: 'END_OF_DAY'
    }));
    const result = await storedService().technicals('SCOM');
    expect(result.observationCount).toBe(30);
    const sma20 = result.items.find((item) => item.name === 'SMA' && item.period === 20) as { value: number | null };
    const sma200 = result.items.find((item) => item.name === 'SMA' && item.period === 200) as {
      value: number | null;
      reason?: string;
    };
    expect(sma20.value).toBeTypeOf('number');
    expect(sma200.value).toBeNull();
    expect(sma200.reason).toContain('Requires 200 observations');
    expect(result.inputThrough).toBe(new Date(2026, 8, 30).toISOString());
    expect(result.warnings!.join(' ')).toContain('not guaranteed predictions');
  });

  it('returns a reason for unknown demo and stored symbols', async () => {
    state.security = null;
    expect((await storedService().technicals('NOPE')).reason).toContain('Security not found');
    const selection = createProviderSelection({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true });
    const demoService = new MarketService(selection.registry);
    const result = await demoService.technicals('NOTAFIXTURE');
    expect(result.items).toEqual([]);
    expect(result.reason).toContain('not one of the demo fixtures');
  });

  it('labels demo technicals as synthetic', async () => {
    const selection = createProviderSelection({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true });
    const result = await new MarketService(selection.registry).technicals('SCOM');
    expect(result.provenance?.kind).toBe('DEMO_FIXTURE');
    expect(result.warnings!.join(' ')).toContain('synthetic');
    expect(result.permission?.status).toBe('NOT_APPLICABLE');
  });
});

describe('demo fixtures', () => {
  it('records adapter success and labels the quote', async () => {
    const selection = createProviderSelection({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true });
    const result = await new MarketService(selection.registry).quote('SCOM');
    expect((result.security as { demo?: boolean } | null)?.demo).toBe(true);
    expect((result.observation as { demo?: boolean } | null)?.demo).toBe(true);
    expect(result.observation?.dataMode).toBe('UNKNOWN');
    expect(result.provenance?.kind).toBe('DEMO_FIXTURE');
  });

  it('refuses to invent a fixture for an unknown symbol', async () => {
    const selection = createProviderSelection({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true });
    const result = await new MarketService(selection.registry).quote('NOTAFIXTURE');
    expect(result.security).toBeNull();
    expect(result.reason).toContain('never returns real securities');
  });

  it('lists only labelled fixtures in the security directory', async () => {
    const selection = createProviderSelection({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true });
    const result = await new MarketService(selection.registry).securities('', 10, 0);
    expect('demo' in result && result.demo).toBe(true);
    expect(result.items.every((item) => item.instrumentType === 'DEMO_FIXTURE')).toBe(true);
  });

  it('passes through the stored security master when demo mode is off', async () => {
    const result = await new MarketService(new ProviderRegistry()).securities('', 10, 0);
    expect(result).toEqual({ items: [], total: null });
  });
});
