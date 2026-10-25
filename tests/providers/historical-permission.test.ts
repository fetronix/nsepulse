import { describe, expect, it, vi } from 'vitest';

const storedSession = {
  sessionDate: new Date('2026-10-20T00:00:00.000Z'),
  open: '10.000000',
  high: '11.000000',
  low: '9.000000',
  close: '10.500000',
  volume: 1000,
  source: 'reviewed-eod-import',
  dataMode: 'END_OF_DAY',
  adjustedForCorporateActions: false
};

vi.mock('../../src/server/db/repository.js', () => ({
  findSecurityBySymbol: vi.fn(async () => ({ id: 'sec-1', symbol: 'SCOM', name: 'Safaricom PLC', exchange: 'NSE', instrumentType: 'EQUITY', listingStatus: 'LISTED', sector: 'Telecommunication', currency: 'KES' })),
  latestObservation: vi.fn(async () => null),
  historicalObservations: vi.fn(async () => [storedSession]),
  searchSecurities: vi.fn(async () => ({ items: [], total: 0 })),
  counts: vi.fn(async () => ({ securities: 1, observations: 0 })),
  dataSnapshot: vi.fn(async () => ({ storeAvailable: true, securities: 1, observations: 0, historicalRows: 1, latestObservationEventAt: null, latestObservationIngestedAt: null, latestHistoricalSessionDate: '2026-10-20T00:00:00.000Z' })),
  listIssuerAnnouncements: vi.fn(async () => [])
}));

const { MarketService } = await import('../../src/server/services/market.js');
const { ProviderRegistry } = await import('../../src/server/providers/types.js');
const { createProviderSelection } = await import('../../src/server/providers/factory.js');
const { DEFAULT_PROVIDER_SETTINGS } = await import('../../src/server/providers/settings.js');

const from = new Date('2026-01-01T00:00:00.000Z');
const to = new Date('2026-12-31T00:00:00.000Z');

describe('historical data permission gate', () => {
  it('withholds stored series until permission is recorded', async () => {
    const service = new MarketService(new ProviderRegistry(), { historicalPermissionConfirmed: false });
    const history = await service.history('SCOM', from, to);
    expect(history.items).toEqual([]);
    expect(history.reason).toContain('withheld');
    expect(history.permission!.status).toBe('UNCONFIRMED');
    expect(history.provenance).toBeNull();
    const technicals = await service.technicals('SCOM');
    expect(technicals.items).toEqual([]);
    expect(technicals.observationCount).toBe(0);
    expect(technicals.permission!.status).toBe('UNCONFIRMED');
    expect(technicals.reason).toContain('HISTORICAL_DATA_PERMISSION_CONFIRMED');
  });

  it('serves stored series with explicit provenance once permission is confirmed', async () => {
    const service = new MarketService(new ProviderRegistry(), { historicalPermissionConfirmed: true });
    const history = await service.history('SCOM', from, to);
    expect(history.items.length).toBe(1);
    expect(history.items[0]?.close).toBe(10.5);
    expect(history.permission!.status).toBe('GRANTED');
    expect(history.provenance?.kind).toBe('STORED_OBSERVATION');
    expect(history.provenance?.liveQuoteAdapterEnabled).toBe(false);
    expect(history.warnings!.join(' ')).toContain('independently of the live quote adapter');
    const technicals = await service.technicals('SCOM');
    expect(technicals.observationCount).toBe(1);
    expect(technicals.items.length).toBe(8);
    expect(technicals.permission!.status).toBe('GRANTED');
  });

  it('does not apply the historical gate to clearly labelled demo fixtures', async () => {
    const selection = createProviderSelection({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true });
    const service = new MarketService(selection.registry, { historicalPermissionConfirmed: false });
    const history = await service.history('SCOM', from, to);
    expect(history.items.length).toBe(8);
    expect(history.permission!.status).toBe('NOT_APPLICABLE');
    expect(history.provenance?.kind).toBe('DEMO_FIXTURE');
    expect(history.warnings!.join(' ')).toContain('not NSE market data');
  });
});
