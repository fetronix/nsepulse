import { describe, expect, it, vi } from 'vitest';
import { MarketService } from '../../src/server/services/market.js';
import { ProviderRegistry, type MarketDataProvider } from '../../src/server/providers/types.js';
import type { MarketObservation } from '../../src/shared/domain.js';

const NOW = new Date('2026-10-25T10:00:00.000Z');

function observation(overrides: Partial<MarketObservation> = {}): MarketObservation {
  return {
    securityId: 'provider:mansa:nse:SCOM',
    symbol: 'SCOM',
    price: 12.45,
    currency: 'KES',
    source: 'Mansa API (mansaapi.com)',
    marketEventAt: '2026-10-25T09:55:00.000Z',
    publishedAt: null,
    ingestedAt: '2026-10-25T09:56:00.000Z',
    dataMode: 'DELAYED',
    validationStatus: 'UNVERIFIED',
    changePercent: 1.22,
    ...overrides
  };
}

function liveProvider(overrides: Partial<MarketDataProvider> = {}): MarketDataProvider {
  return {
    id: 'mansa',
    demo: false,
    live: true,
    capabilities: () =>
      ({
        displayName: 'Mansa API (mansaapi.com)',
        adapterVersion: '0.1.0',
        accessLevel: 'DELAYED',
        entitlement: 'CONTRACTED',
        coverage: {
          state: 'DECLARED',
          securitiesScope: 'Kenyan equities',
          symbols: null,
          symbolCount: null,
          fields: ['price'],
          intervals: [],
          historyDepth: 'Pro plan',
          includesIndices: true,
          notes: []
        },
        demo: false,
        documentationUrl: 'https://mansaapi.com/docs'
      }) as never,
    status: async () => ({
      provider: 'mansa',
      configured: true,
      state: 'READY',
      message: 'ok',
      lastSuccessAt: NOW.toISOString(),
      dataMode: 'DELAYED'
    }),
    getLatestQuote: vi.fn(async () => observation()),
    getHistory: vi.fn(async () => []),
    selfTest: async () => ({ connection: {} as never, dataValidation: {} as never }),
    getMovers: vi.fn(async (request) => ({
      type: request.type,
      items: [
        {
          symbol: 'SCOM',
          price: 12.45,
          changePercent: 4.2,
          currency: 'KES' as const,
          marketEventAt: '2026-10-25T09:55:00.000Z',
          dataMode: 'DELAYED' as const
        }
      ],
      retrievedAt: NOW.toISOString(),
      freshnessNote: 'Delayed snapshot.'
    })),
    describeLastFailure: () => null,
    ...overrides
  };
}

function service(provider: MarketDataProvider) {
  return new MarketService(new ProviderRegistry([provider]), {
    historicalPermissionConfirmed: false
  });
}

describe('MarketService with a live provider', () => {
  it('returns the provider observation with provider provenance', async () => {
    const market = service(liveProvider());
    const result = await market.quote('SCOM');
    expect(result.observation).toMatchObject({ price: 12.45, currency: 'KES', dataMode: 'DELAYED' });
    expect(result.provenance).toMatchObject({
      kind: 'PROVIDER_QUOTE',
      liveQuoteAdapterEnabled: true,
      dataMode: 'DELAYED',
      source: 'Mansa API (mansaapi.com)'
    });
    expect(result.warnings.join(' ')).toMatch(/delayed market data, not real-time/);
  });

  it('flags a provider snapshot older than 24 hours as stale', async () => {
    const staleAt = new Date(Date.now() - 30 * 60 * 60_000).toISOString();
    const market = service(
      liveProvider({ getLatestQuote: vi.fn(async () => observation({ marketEventAt: staleAt })) })
    );
    const result = await market.quote('SCOM');
    expect((result.observation as { stale?: boolean }).stale).toBe(true);
    expect(result.provenance?.freshnessNote).toMatch(/stale/);
  });

  it('reports unavailability when the provider fails and nothing is stored', async () => {
    const market = service(
      liveProvider({
        getLatestQuote: vi.fn(async () => null),
        describeLastFailure: () => 'RATE_LIMIT (HTTP 429): daily limit reached.'
      })
    );
    const result = await market.quote('SCOM');
    expect(result.observation).toBeNull();
    expect(result.reason).toMatch(/provider did not supply one/);
    expect(result.reason).toMatch(/RATE_LIMIT/);
  });

  it('exposes movers and marks them delayed', async () => {
    const market = service(liveProvider());
    const movers = await market.movers('gainers', 5);
    expect(movers.available).toBe(true);
    expect(movers.items[0]).toMatchObject({ symbol: 'SCOM', changePercent: 4.2 });
    expect(movers.warnings.join(' ')).toMatch(/not real-time/);
  });

  it('reports movers as unavailable for a provider without such an endpoint', async () => {
    const market = service(liveProvider({ getMovers: undefined }));
    const movers = await market.movers('gainers', 5);
    expect(movers.available).toBe(false);
    expect(movers.reason).toMatch(/does not document a gainers\/losers endpoint/);
  });

  it('does not present a provider failure as an empty success', async () => {
    const market = service(liveProvider({ getMovers: vi.fn(async () => null) }));
    const movers = await market.movers('losers', 5);
    expect(movers.available).toBe(false);
    expect(movers.reason).toMatch(/No verified movers/);
  });
});
