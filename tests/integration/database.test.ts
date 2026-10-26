import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDatabase, closeDatabase } from '../../src/server/db/client.js';
import {
  counts,
  dataSnapshot,
  findSecurityBySymbol,
  historicalObservations,
  latestObservation,
  listIssuerAnnouncements,
  searchSecurities
} from '../../src/server/db/repository.js';
import { DataSourceService } from '../../src/server/services/data-sources.js';
import { createProviderSelection } from '../../src/server/providers/factory.js';
import { DEFAULT_PROVIDER_SETTINGS } from '../../src/server/providers/settings.js';

/**
 * Real PostgreSQL tests. They run only when TEST_DATABASE_URL points at a disposable
 * database whose name contains "test" (see tests/integration/setup.ts). Without it the
 * whole file is skipped and reported as skipped rather than passing.
 */
const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;

let pool: Pool | null = null;

const SECURITY_ID = '11111111-1111-4111-8111-111111111111';

integration('PostgreSQL repository integration', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl });
    await migrate(getDatabase()!, { migrationsFolder: './drizzle/generated' });
    await pool.query(
      'TRUNCATE news_articles, news_sources, market_observations, historical_prices, securities CASCADE'
    );
    await pool.query(
      `INSERT INTO securities (id, symbol, name, exchange, instrument_type, listing_status, sector, currency, source, source_verified_at, review_required)
       VALUES ($1, 'SCOM', 'Safaricom PLC', 'NSE', 'EQUITY', 'LISTED', 'Telecommunication', 'KES', 'integration-fixture', now(), true),
              ('11111111-1111-4111-8111-111111111112', 'EQTY', 'Equity Group Holdings', 'NSE', 'EQUITY', 'LISTED', 'Banking', 'KES', 'integration-fixture', now(), true)`,
      [SECURITY_ID]
    );
    await pool.query(
      `INSERT INTO market_observations (security_id, price, open, high, low, previous_close, volume, turnover, currency, source, market_event_at, published_at, data_mode, validation_status)
       VALUES ($1, '12.500000', '12.000000', '12.800000', '11.900000', '12.100000', 1500, '18500.0000', 'KES', 'integration-fixture', now() - interval '1 hour', now() - interval '1 hour', 'END_OF_DAY', 'VALID')`,
      [SECURITY_ID]
    );
    await pool.query(
      `INSERT INTO historical_prices (security_id, session_date, open, high, low, close, volume, source, data_mode, adjusted_for_corporate_actions)
       VALUES ($1, current_date - interval '2 day', '12.000000', '12.800000', '11.900000', '12.500000', 1500, 'integration-fixture', 'END_OF_DAY', false),
              ($1, current_date - interval '1 day', '12.500000', '12.900000', '12.200000', '12.700000', 1200, 'integration-fixture', 'END_OF_DAY', false)`,
      [SECURITY_ID]
    );
    await pool.query(
      `INSERT INTO news_sources (id, name, source_type, feed_url, terms_url, enabled)
       VALUES ('22222222-2222-4222-8222-222222222221', 'Enabled issuer announcements', 'ISSUER_ANNOUNCEMENT', NULL, 'https://example.invalid/terms', true),
              ('22222222-2222-4222-8222-222222222222', 'Disabled issuer announcements', 'ISSUER_ANNOUNCEMENT', NULL, 'https://example.invalid/terms', false)`
    );
    await pool.query(
      `INSERT INTO news_articles (source_id, original_url, title, publisher, published_at, verified)
       VALUES ('22222222-2222-4222-8222-222222222221', 'https://example.invalid/enabled.pdf', 'Enabled announcement', 'Example PLC', now(), true),
              ('22222222-2222-4222-8222-222222222222', 'https://example.invalid/disabled.pdf', 'Disabled announcement', 'Example PLC', now(), false)`
    );
  });

  afterAll(async () => {
    await pool?.end();
    pool = null;
    await closeDatabase();
  });

  it('searches and normalises symbols against real SQL', async () => {
    const all = await searchSecurities('', 10, 0);
    expect(all.items.map((item) => item.symbol)).toEqual(['EQTY', 'SCOM']);
    const filtered = await searchSecurities('safa', 10, 0);
    expect(filtered.items.map((item) => item.symbol)).toEqual(['SCOM']);
    const paged = await searchSecurities('', 1, 1);
    expect(paged.items).toHaveLength(1);
    const bySymbol = await findSecurityBySymbol('scom');
    expect(bySymbol?.name).toBe('Safaricom PLC');
    expect(await findSecurityBySymbol('missing')).toBeNull();
  });

  it('returns the latest observation with numeric columns as strings', async () => {
    const observation = await latestObservation(SECURITY_ID);
    expect(observation?.price).toBe('12.500000');
    expect(observation?.source).toBe('integration-fixture');
    expect(observation?.dataMode).toBe('END_OF_DAY');
  });

  it('filters historical rows by session range and orders them', async () => {
    const rows = await historicalObservations(
      SECURITY_ID,
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date(Date.now() + 24 * 60 * 60 * 1000)
    );
    expect(rows.map((row) => row.close)).toEqual(['12.500000', '12.700000']);
    const none = await historicalObservations(SECURITY_ID, new Date('2000-01-01'), new Date('2000-01-31'));
    expect(none).toEqual([]);
  });

  it('counts and snapshots persisted data', async () => {
    expect(await counts()).toEqual({ securities: 2, observations: 1 });
    const snapshot = await dataSnapshot();
    expect(snapshot.storeAvailable).toBe(true);
    expect(snapshot.securities).toBe(2);
    expect(snapshot.historicalRows).toBe(2);
    expect(snapshot.latestObservationIngestedAt).not.toBeNull();
    expect(snapshot.latestHistoricalSessionDate).not.toBeNull();
  });

  it('returns only announcements from enabled sources', async () => {
    const rows = await listIssuerAnnouncements(10);
    expect(rows?.map((row) => row.title)).toEqual(['Enabled announcement']);
    const permitted = new DataSourceService(
      { ...DEFAULT_PROVIDER_SETTINGS, announcementsPermissionConfirmed: true },
      createProviderSelection(DEFAULT_PROVIDER_SETTINGS)
    );
    const response = await permitted.announcements();
    expect(response.state).toBe('OK');
    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.sourceUrl).toBe('https://example.invalid/enabled.pdf');
  });

  it('enforces the historical permission gate against real data', async () => {
    const { MarketService } = await import('../../src/server/services/market.js');
    const { ProviderRegistry } = await import('../../src/server/providers/types.js');
    const blocked = await new MarketService(new ProviderRegistry(), { historicalPermissionConfirmed: false }).history(
      'SCOM',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date()
    );
    expect(blocked.items).toEqual([]);
    expect(blocked.reason).toContain('withheld');

    const allowed = await new MarketService(new ProviderRegistry(), { historicalPermissionConfirmed: true }).history(
      'SCOM',
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      new Date()
    );
    expect(allowed.items).toHaveLength(2);
    expect(allowed.items[1]).toMatchObject({ close: 12.7, volume: 1200 });
  });

  it('rejects duplicate securities through the unique constraint', async () => {
    await expect(
      pool!.query(
        `INSERT INTO securities (symbol, name, exchange, instrument_type, listing_status, currency) VALUES ('SCOM', 'Duplicate', 'NSE', 'EQUITY', 'LISTED', 'KES')`
      )
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
