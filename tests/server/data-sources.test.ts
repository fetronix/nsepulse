import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Data-source permission and freshness reporting. The repository layer is stubbed here;
 * the SQL itself is covered by the PostgreSQL integration suite.
 */
const store = {
  snapshot: {
    storeAvailable: true,
    securities: 12,
    observations: 3,
    historicalRows: 480,
    latestObservationEventAt: null,
    latestObservationIngestedAt: null,
    latestHistoricalSessionDate: '2026-10-23T00:00:00.000Z'
  },
  announcements: [] as {
    id: string;
    title: string;
    publisher: string;
    originalUrl: string;
    publishedAt: Date | null;
    verified: boolean;
    sourceType: string;
  }[],
  announcementsAvailable: true
};

vi.mock('../../src/server/db/repository.js', () => ({
  dataSnapshot: vi.fn(async () => store.snapshot),
  listIssuerAnnouncements: vi.fn(async () => (store.announcementsAvailable ? store.announcements : null)),
  searchSecurities: vi.fn(),
  findSecurityBySymbol: vi.fn(),
  latestObservation: vi.fn(),
  historicalObservations: vi.fn(),
  counts: vi.fn()
}));

const { DataSourceService } = await import('../../src/server/services/data-sources.js');
const { createProviderSelection } = await import('../../src/server/providers/factory.js');
const { DEFAULT_PROVIDER_SETTINGS } = await import('../../src/server/providers/settings.js');

function service(settings = DEFAULT_PROVIDER_SETTINGS) {
  return new DataSourceService(settings, createProviderSelection(settings));
}

beforeEach(() => {
  store.snapshot = {
    storeAvailable: true,
    securities: 12,
    observations: 3,
    historicalRows: 480,
    latestObservationEventAt: null,
    latestObservationIngestedAt: null,
    latestHistoricalSessionDate: '2026-10-23T00:00:00.000Z'
  };
  store.announcements = [];
  store.announcementsAvailable = true;
});

describe('data-source listing', () => {
  it('reports the live feed as unconfigured and each stored source separately', async () => {
    const { items } = await service().list(new Date('2026-10-25T10:00:00.000Z'));
    const live = items.find((item) => item.id === 'live-quotes')!;
    const historical = items.find((item) => item.id === 'historical-eod')!;
    const announcements = items.find((item) => item.id === 'issuer-announcements')!;
    const master = items.find((item) => item.id === 'security-master')!;

    expect(live.permission.status).toBe('NOT_REQUESTED');
    expect(live.freshness.label).toBe('UNKNOWN');
    expect(live.availability.state).toBe('NOT_CONFIGURED');
    expect(live.independentOfLiveQuoteAdapter).toBe(false);

    expect(historical.freshness.label).toBe('END_OF_DAY');
    expect(historical.independentOfLiveQuoteAdapter).toBe(true);
    expect(historical.permission.status).toBe('UNCONFIRMED');
    expect(historical.availability.state).toBe('PERMISSION_BLOCKED');

    expect(announcements.freshness.label).toBe('AS_PUBLISHED');
    expect(announcements.availability.state).toBe('PERMISSION_BLOCKED');

    expect(master.freshness.label).toBe('REFERENCE');
    expect(master.availability.state).toBe('AVAILABLE');
  });

  it('marks the live feed disabled while demo fixtures are active', async () => {
    const demo = { ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true };
    const { items } = await service(demo).list();
    const live = items.find((item) => item.id === 'live-quotes')!;
    expect(live.availability.state).toBe('DISABLED');
    expect(live.availability.message).toContain('demo fixture adapter');
  });

  it('surfaces stored history once permission is confirmed', async () => {
    const permitted = { ...DEFAULT_PROVIDER_SETTINGS, historicalPermissionConfirmed: true };
    const historical = (await service(permitted).list()).items.find((item) => item.id === 'historical-eod')!;
    expect(historical.permission.status).toBe('GRANTED');
    expect(historical.availability.state).toBe('AVAILABLE');
    expect(historical.availability.message).toContain('480');
    expect(historical.lastRetrievedAt).toBe('2026-10-23T00:00:00.000Z');
  });

  it('reports an empty permitted historical store distinctly from a blocked one', async () => {
    store.snapshot = { ...store.snapshot, historicalRows: 0 };
    const permitted = { ...DEFAULT_PROVIDER_SETTINGS, historicalPermissionConfirmed: true };
    const historical = (await service(permitted).list()).items.find((item) => item.id === 'historical-eod')!;
    expect(historical.availability.state).toBe('EMPTY');
  });

  it('distinguishes a missing database from missing permission', async () => {
    store.snapshot = { ...store.snapshot, storeAvailable: false };
    const { items } = await service().list();
    // A missing store is reported before missing permission, because both block serving.
    expect(items.find((item) => item.id === 'historical-eod')!.availability.state).toBe('STORE_UNAVAILABLE');
    expect(items.find((item) => item.id === 'security-master')!.availability.state).toBe('STORE_UNAVAILABLE');
    const permitted = { ...DEFAULT_PROVIDER_SETTINGS, historicalPermissionConfirmed: true };
    expect(
      (await service(permitted).list()).items.find((item) => item.id === 'historical-eod')!.availability.state
    ).toBe('STORE_UNAVAILABLE');
  });

  it('reports an empty security master', async () => {
    store.snapshot = { ...store.snapshot, securities: 0 };
    expect((await service().list()).items.find((item) => item.id === 'security-master')!.availability.state).toBe(
      'EMPTY'
    );
  });
});

describe('announcement endpoint states', () => {
  it('withholds announcements without recorded permission', async () => {
    const response = await service().announcements();
    expect(response.state).toBe('PERMISSION_UNCONFIRMED');
    expect(response.items).toEqual([]);
    expect(response.permission.status).toBe('UNCONFIRMED');
    expect(response.freshness.label).toBe('AS_PUBLISHED');
  });

  it('reports an unavailable store when permission exists but no database is configured', async () => {
    store.announcementsAvailable = false;
    const permitted = { ...DEFAULT_PROVIDER_SETTINGS, announcementsPermissionConfirmed: true };
    const response = await service(permitted).announcements();
    expect(response.state).toBe('STORE_UNAVAILABLE');
    expect(response.permission.status).toBe('GRANTED');
  });

  it('reports an empty permitted store', async () => {
    const permitted = { ...DEFAULT_PROVIDER_SETTINGS, announcementsPermissionConfirmed: true };
    const response = await service(permitted).announcements();
    expect(response.state).toBe('EMPTY');
    expect(response.items).toEqual([]);
  });

  it('serves stored announcements as published with source links', async () => {
    store.announcements = [
      {
        id: 'a1',
        title: 'Final dividend announcement',
        publisher: 'Example PLC',
        originalUrl: 'https://example.invalid/a1.pdf',
        publishedAt: new Date('2026-10-20T09:00:00.000Z'),
        verified: true,
        sourceType: 'ISSUER_ANNOUNCEMENT'
      }
    ];
    const permitted = { ...DEFAULT_PROVIDER_SETTINGS, announcementsPermissionConfirmed: true };
    const response = await service(permitted).announcements(10);
    expect(response.state).toBe('OK');
    expect(response.items[0]).toMatchObject({
      title: 'Final dividend announcement',
      sourceUrl: 'https://example.invalid/a1.pdf',
      publishedAt: '2026-10-20T09:00:00.000Z',
      freshness: 'AS_PUBLISHED',
      symbol: null
    });
  });
});
