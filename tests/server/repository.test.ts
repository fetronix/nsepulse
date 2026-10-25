import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Repository tests with a stubbed query builder.
 *
 * These verify result mapping, null handling and query shape of the repository layer.
 * Real SQL execution and constraint behaviour are covered separately by the PostgreSQL
 * integration suite (`tests/integration/`), which is skipped unless TEST_DATABASE_URL
 * points at a disposable database.
 */

type Result = unknown[];

let queue: Result[] = [];
let fakeDb: unknown = null;
let failing = false;

function chain() {
  const next = () => {
    if (failing) return Promise.reject(new Error('connection lost'));
    return Promise.resolve(queue.shift() ?? []);
  };
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'innerJoin', 'groupBy']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) =>
    next().then(resolve, reject);
  return builder;
}

vi.mock('../../src/server/db/client.js', () => ({
  getDatabase: () => fakeDb,
  databaseHealth: vi.fn(),
  withAdvisoryLock: vi.fn(),
  closeDatabase: vi.fn()
}));

const repository = await import('../../src/server/db/repository.js');

beforeEach(() => {
  queue = [];
  failing = false;
  fakeDb = { select: vi.fn(() => chain()) };
});

describe('repository without a database', () => {
  beforeEach(() => {
    fakeDb = null;
  });

  it('returns safe empty shapes instead of throwing', async () => {
    expect(await repository.searchSecurities('scom', 10, 0)).toEqual({ items: [], total: null });
    expect(await repository.findSecurityBySymbol('SCOM')).toBeNull();
    expect(await repository.latestObservation('id')).toBeNull();
    expect(await repository.historicalObservations('id', new Date(0), new Date())).toEqual([]);
    expect(await repository.counts()).toEqual({ securities: null, observations: null });
    expect(await repository.listIssuerAnnouncements()).toBeNull();
    expect(await repository.dataSnapshot()).toMatchObject({ storeAvailable: false, securities: null });
  });
});

describe('security queries', () => {
  it('returns matching securities and always reports a null total', async () => {
    queue = [
      [
        {
          id: 'sec-1',
          symbol: 'SCOM',
          name: 'Safaricom PLC',
          exchange: 'NSE',
          instrumentType: 'EQUITY',
          listingStatus: 'LISTED',
          sector: 'Telecommunication'
        }
      ]
    ];
    const result = await repository.searchSecurities('SCOM', 10, 0);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBeNull();
  });

  it('returns null when a symbol is unknown and the row when found', async () => {
    queue = [[]];
    expect(await repository.findSecurityBySymbol('nope')).toBeNull();
    queue = [[{ id: 'sec-1', symbol: 'SCOM' }]];
    expect(await repository.findSecurityBySymbol('scom')).toMatchObject({ symbol: 'SCOM' });
  });

  it('returns the latest observation and empty history safely', async () => {
    queue = [[{ id: 'obs-1', price: '12.500000' }], []];
    expect(await repository.latestObservation('sec-1')).toMatchObject({ id: 'obs-1' });
    expect(await repository.historicalObservations('sec-1', new Date(0), new Date())).toEqual([]);
  });

  it('maps count results and defaults missing rows to zero', async () => {
    queue = [[{ value: 4 }], [{ value: 9 }]];
    expect(await repository.counts()).toEqual({ securities: 4, observations: 9 });
    queue = [[], []];
    expect(await repository.counts()).toEqual({ securities: 0, observations: 0 });
  });
});

describe('data snapshot', () => {
  it('reports counts and the most recent persisted timestamps', async () => {
    queue = [
      [{ value: 12 }],
      [{ value: 3 }],
      [{ value: 480 }],
      [{ marketEventAt: new Date('2026-10-24T00:00:00.000Z'), ingestedAt: new Date('2026-10-24T06:00:00.000Z') }],
      [{ sessionDate: new Date('2026-10-23T00:00:00.000Z') }]
    ];
    const snapshot = await repository.dataSnapshot();
    expect(snapshot).toEqual({
      storeAvailable: true,
      securities: 12,
      observations: 3,
      historicalRows: 480,
      latestObservationEventAt: '2026-10-24T00:00:00.000Z',
      latestObservationIngestedAt: '2026-10-24T06:00:00.000Z',
      latestHistoricalSessionDate: '2026-10-23T00:00:00.000Z'
    });
  });

  it('reports null timestamps when the store is empty', async () => {
    queue = [[{ value: 0 }], [{ value: 0 }], [{ value: 0 }], [], []];
    const snapshot = await repository.dataSnapshot();
    expect(snapshot.storeAvailable).toBe(true);
    expect(snapshot.latestObservationEventAt).toBeNull();
    expect(snapshot.latestHistoricalSessionDate).toBeNull();
  });

  it('degrades to an unavailable store when a query fails', async () => {
    failing = true;
    const snapshot = await repository.dataSnapshot();
    expect(snapshot.storeAvailable).toBe(false);
    expect(snapshot.securities).toBeNull();
  });
});

describe('issuer announcements', () => {
  it('returns only rows supplied by the enabled-source join', async () => {
    queue = [
      [
        {
          id: 'a1',
          title: 'Dividend announcement',
          publisher: 'Example PLC',
          originalUrl: 'https://example.invalid/a1',
          publishedAt: new Date('2026-10-20T09:00:00.000Z'),
          verified: true,
          sourceType: 'ISSUER_ANNOUNCEMENT'
        }
      ]
    ];
    const rows = await repository.listIssuerAnnouncements(5);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.sourceType).toBe('ISSUER_ANNOUNCEMENT');
  });

  it('returns an empty list when no permitted source has stored items', async () => {
    queue = [[]];
    expect(await repository.listIssuerAnnouncements()).toEqual([]);
  });
});
