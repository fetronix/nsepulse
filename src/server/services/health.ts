import { databaseHealth } from '../db/client.js';
import { dataSnapshot } from '../db/repository.js';
import type { ProviderRegistry } from '../providers/types.js';

export interface LivenessReport {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  timezone: 'Africa/Nairobi';
}

export interface ReadinessReport {
  status: 'ready' | 'degraded' | 'not_ready';
  timestamp: string;
  checks: {
    process: { ok: boolean; detail: string };
    database: {
      ok: boolean;
      configured: boolean;
      schemaInitialised: boolean | null;
      detail: string;
      hint: string | null;
    };
    provider: { ok: boolean; state: string; liveQuoteAdapterEnabled: boolean; detail: string };
    dataFreshness: { status: 'OK' | 'STALE' | 'NO_DATA' | 'UNKNOWN'; latestObservationAt: string | null };
  };
}

const VERSION = '0.1.0';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function freshnessStatus(latestObservationAt: string | null, now: Date): 'OK' | 'STALE' | 'NO_DATA' | 'UNKNOWN' {
  if (!latestObservationAt) return 'NO_DATA';
  const observedAt = new Date(latestObservationAt).getTime();
  if (!Number.isFinite(observedAt) || observedAt > now.getTime()) return 'UNKNOWN';
  return now.getTime() - observedAt > STALE_AFTER_MS ? 'STALE' : 'OK';
}

/** Liveness answers "is the process running?" and never depends on downstream services. */
export function livenessReport(now = new Date()): LivenessReport {
  return {
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: now.toISOString(),
    timezone: 'Africa/Nairobi'
  };
}

/**
 * Readiness answers "can this instance serve honest responses right now?".
 *
 * A database that is not configured is the documented degraded-but-servable mode (the
 * API returns explicit empty states), so it is `ready`. A configured but unreachable
 * database is `not_ready`, because persisted-data routes cannot be trusted.
 */
export async function readinessReport(providers: ProviderRegistry, now = new Date()): Promise<ReadinessReport> {
  const database = await databaseHealth();
  const statuses = await providers.statuses();
  const primary = statuses[0];
  const liveQuoteAdapterEnabled = Boolean(primary && primary.state === 'READY' && primary.configured);

  const latestObservationAt = await dataSnapshot()
    .then((snapshot) => snapshot.latestObservationEventAt)
    .catch(() => null);

  const databaseOk = database.configured ? database.reachable && database.schema.initialised : true;
  const status: ReadinessReport['status'] = !databaseOk ? 'not_ready' : primary ? 'ready' : 'degraded';
  const databaseDetail =
    database.reachable && !database.schema.initialised
      ? `${database.message} ${database.schema.message}`
      : database.message;

  return {
    status,
    timestamp: now.toISOString(),
    checks: {
      process: { ok: true, detail: 'HTTP server is accepting requests.' },
      database: {
        ok: databaseOk,
        configured: database.configured,
        schemaInitialised: database.configured ? database.schema.initialised : null,
        detail: databaseDetail,
        hint: database.schema.hint
      },
      provider: {
        ok: Boolean(primary),
        state: primary?.state ?? 'MISSING',
        liveQuoteAdapterEnabled,
        detail: primary?.message ?? 'No provider adapter is registered.'
      },
      dataFreshness: { status: freshnessStatus(latestObservationAt, now), latestObservationAt }
    }
  };
}
