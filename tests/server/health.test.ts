import { afterEach, describe, expect, it, vi } from 'vitest';
import { livenessReport, readinessReport } from '../../src/server/services/health.js';
import { ProviderRegistry } from '../../src/server/providers/types.js';
import { DemoFixtureProvider } from '../../src/server/providers/demo.js';
import { VendorPendingProvider } from '../../src/server/providers/vendor-pending.js';
import type { ProviderStatus } from '../../src/shared/domain.js';

const database = {
  configured: false,
  reachable: false,
  message: 'DATABASE_URL is not configured.',
  schema: {
    initialised: false,
    checkedTable: 'securities',
    message: 'No database is configured, so no schema was checked.',
    hint: null as string | null
  }
};

vi.mock('../../src/server/db/client.js', () => ({
  databaseHealth: vi.fn(async () => database),
  getDatabase: vi.fn(),
  withAdvisoryLock: vi.fn(),
  closeDatabase: vi.fn()
}));

let snapshot: { latestObservationEventAt: string | null } = { latestObservationEventAt: null };

vi.mock('../../src/server/db/repository.js', () => ({
  dataSnapshot: vi.fn(async () => ({
    storeAvailable: false,
    securities: null,
    observations: null,
    historicalRows: null,
    latestObservationEventAt: snapshot.latestObservationEventAt,
    latestObservationIngestedAt: null,
    latestHistoricalSessionDate: null
  }))
}));

afterEach(() => {
  database.configured = false;
  database.reachable = false;
  database.message = 'DATABASE_URL is not configured.';
  database.schema.initialised = false;
  database.schema.hint = null;
  database.schema.message = 'No database is configured, so no schema was checked.';
  snapshot = { latestObservationEventAt: null };
});

describe('liveness', () => {
  it('reports the process as up without touching dependencies', () => {
    const report = livenessReport(new Date('2026-10-25T10:00:00.000Z'));
    expect(report).toMatchObject({
      status: 'ok',
      version: '0.1.0',
      timestamp: '2026-10-25T10:00:00.000Z',
      timezone: 'Africa/Nairobi'
    });
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('readiness', () => {
  it('is ready in the documented no-database mode and reports no data', async () => {
    const report = await readinessReport(new ProviderRegistry());
    expect(report.status).toBe('ready');
    expect(report.checks.database).toMatchObject({ ok: true, configured: false });
    expect(report.checks.provider.state).toBe('UNCONFIGURED');
    expect(report.checks.provider.liveQuoteAdapterEnabled).toBe(false);
    expect(report.checks.dataFreshness).toEqual({ status: 'NO_DATA', latestObservationAt: null });
  });

  it('is not ready when a configured database is unreachable', async () => {
    database.configured = true;
    database.reachable = false;
    database.message = 'Database connection failed; details are intentionally not exposed.';
    database.schema.hint = 'PostgreSQL is not accepting connections.';
    const report = await readinessReport(new ProviderRegistry());
    expect(report.status).toBe('not_ready');
    expect(report.checks.database.ok).toBe(false);
    expect(report.checks.database.schemaInitialised).toBe(false);
  });

  it('is not ready when the database is reachable but has never been migrated', async () => {
    database.configured = true;
    database.reachable = true;
    database.message = 'PostgreSQL is reachable, but the application schema has not been created.';
    database.schema.initialised = false;
    database.schema.message = 'Table "securities" is missing: no migration has been applied to this database.';
    database.schema.hint = 'Run `npm run db:migrate` against this DATABASE_URL.';
    const report = await readinessReport(new ProviderRegistry());
    expect(report.status).toBe('not_ready');
    expect(report.checks.database).toMatchObject({
      ok: false,
      configured: true,
      schemaInitialised: false,
      hint: 'Run `npm run db:migrate` against this DATABASE_URL.'
    });
    expect(report.checks.database.detail).toContain('Table "securities" is missing');
  });

  it('reports fresh and stale stored data distinctly', async () => {
    snapshot = { latestObservationEventAt: new Date().toISOString() };
    expect((await readinessReport(new ProviderRegistry())).checks.dataFreshness.status).toBe('OK');

    snapshot = { latestObservationEventAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() };
    expect((await readinessReport(new ProviderRegistry())).checks.dataFreshness.status).toBe('STALE');

    snapshot = { latestObservationEventAt: 'not-a-date' };
    expect((await readinessReport(new ProviderRegistry())).checks.dataFreshness.status).toBe('UNKNOWN');
  });

  it('never reports a demo adapter as a live quote adapter', async () => {
    const report = await readinessReport(new ProviderRegistry([new DemoFixtureProvider()]));
    expect(report.checks.provider.state).toBe('DEMO');
    expect(report.checks.provider.liveQuoteAdapterEnabled).toBe(false);
  });

  it('degrades when no provider is registered at all', async () => {
    const empty = new ProviderRegistry([]);
    const statuses = vi.spyOn(empty, 'statuses').mockResolvedValue([]);
    const report = await readinessReport(empty);
    expect(report.status).toBe('degraded');
    expect(report.checks.provider.ok).toBe(false);
    statuses.mockRestore();
  });

  it('reports a blocked vendor placeholder as not enabled', async () => {
    const report = await readinessReport(
      new ProviderRegistry([new VendorPendingProvider({ baseUrlConfigured: true, apiKeyConfigured: true })])
    );
    expect(report.checks.provider.state).toBe('UNCONFIGURED');
    expect(report.checks.provider.liveQuoteAdapterEnabled).toBe(false);
  });

  it('reports readiness for a genuinely ready contracted adapter', async () => {
    const ready: ProviderStatus = {
      provider: 'contract-test',
      configured: true,
      state: 'READY',
      message: 'Contracted adapter ready.',
      lastSuccessAt: null,
      dataMode: 'END_OF_DAY'
    };
    const registry = new ProviderRegistry([]);
    vi.spyOn(registry, 'statuses').mockResolvedValue([ready]);
    const report = await readinessReport(registry);
    expect(report.checks.provider.liveQuoteAdapterEnabled).toBe(true);
    expect(report.status).toBe('ready');
  });
});
