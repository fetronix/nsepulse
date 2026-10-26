import cron from 'node-cron';
import type { Logger } from 'pino';
import { config } from '../config.js';
import { withAdvisoryLock } from '../db/client.js';
import { moduleLogger } from '../logging/logger.js';
import { defaultProviderSelection } from '../providers/factory.js';

const jobs = defaultProviderSelection().registry;

/** Retry helper for idempotent background work; exponential backoff with bounded delay. */
export async function retry<T>(task: () => Promise<T>, attempts = 3, initialDelayMs = 250): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(initialDelayMs * 2 ** attempt, 5000)));
      }
    }
  }
  throw lastError;
}

export interface SchedulerOptions {
  /** Injectable logger so tests can assert structured output. */
  logger?: Logger;
}

/**
 * Operational heartbeat only. No data polling is scheduled until an authorized adapter
 * exists; enabling the scheduler does not make market data available.
 */
export function startScheduler(options: SchedulerOptions = {}) {
  const log = options.logger ?? moduleLogger('jobs');
  if (config.ENABLE_SCHEDULER !== 'true' || !config.DATABASE_URL) {
    log.info(
      {
        job: 'scheduler',
        outcome: 'disabled',
        reason: !config.DATABASE_URL ? 'DATABASE_URL is not configured' : 'ENABLE_SCHEDULER is not true'
      },
      'scheduler_disabled'
    );
    return () => undefined;
  }
  const task = cron.schedule(
    '*/5 * * * *',
    async () => {
      const startedAt = Date.now();
      try {
        await withAdvisoryLock(814_782_025, async () => {
          const statuses = await retry(() => jobs.statuses());
          log.info(
            {
              job: 'provider_health_check',
              outcome: 'success',
              durationMs: Date.now() - startedAt,
              providers: statuses.map((status) => ({
                provider: status.provider,
                state: status.state,
                dataMode: status.dataMode
              }))
            },
            'provider_health_check'
          );
        });
      } catch (error) {
        log.error(
          {
            job: 'provider_health_check',
            outcome: 'failure',
            durationMs: Date.now() - startedAt,
            errorClass: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: error instanceof Error ? error.message : 'unknown'
          },
          'provider_health_check_failed'
        );
      }
    },
    { timezone: 'Africa/Nairobi' }
  );
  const stopRefresh = scheduleSnapshotRefresh(jobs.primary, log);
  return () => {
    task.stop();
    stopRefresh();
  };
}

/**
 * Warm the provider snapshot every 30 minutes.
 *
 * The interval matches Mansa's documented 30-minute freshness target, so refreshes never
 * chase a faster cadence than the provider claims to offer. At 48 runs/day this leaves the
 * remainder of the documented 100 request/day free tier for interactive quotes; the adapter
 * additionally refuses to exceed its local budget.
 *
 * Only the owner of the advisory lock refreshes, so replicas do not multiply quota use.
 */
/**
 * The subset of a provider the snapshot refresh needs.
 *
 * This is an explicit contract rather than a cast: an adapter that is `live` is not
 * necessarily a Mansa adapter, and calling a method that does not exist would fail only at
 * 30-minute intervals, in a scheduled job, at night.
 */
export interface SnapshotRefresher {
  id: string;
  live?: boolean;
  refreshSnapshot?: () => Promise<number>;
  usage?: () => unknown;
}

export type SnapshotRefreshOutcome = 'refreshed' | 'skipped' | 'failed';

/**
 * Perform one snapshot refresh attempt and contain every failure.
 *
 * Two defects made this necessary. The refresh awaited `withAdvisoryLock` *outside* its
 * try/catch, so a database failure while acquiring the lock produced an unhandled promise
 * rejection from a cron callback — invisible in the logs and fatal under
 * `--unhandled-rejections=strict`. And the provider was cast to `MansaProvider` on `live`
 * alone, so any other live adapter would throw every 30 minutes.
 *
 * Returns the outcome so the behaviour is testable without waiting for a cron tick.
 */
export async function refreshProviderSnapshotOnce(
  provider: SnapshotRefresher,
  log: Logger
): Promise<SnapshotRefreshOutcome> {
  if (!provider.live || typeof provider.refreshSnapshot !== 'function') {
    log.debug(
      { job: 'provider_snapshot_refresh', outcome: 'skipped', provider: provider.id },
      'provider_snapshot_refresh_skipped'
    );
    return 'skipped';
  }

  const startedAt = Date.now();
  const usage = (): unknown => {
    try {
      return provider.usage?.() ?? null;
    } catch {
      return null;
    }
  };

  try {
    const result = await withAdvisoryLock(814_782_026, async () => provider.refreshSnapshot!());
    if (result === null) {
      // Another replica owns the refresh; staying quiet keeps the log honest.
      log.info(
        {
          job: 'provider_snapshot_refresh',
          outcome: 'skipped',
          provider: provider.id,
          reason: 'refresh lock held elsewhere'
        },
        'provider_snapshot_refresh_skipped'
      );
      return 'skipped';
    }
    log.info(
      {
        job: 'provider_snapshot_refresh',
        outcome: 'success',
        provider: provider.id,
        records: result,
        usage: usage(),
        durationMs: Date.now() - startedAt
      },
      'provider_snapshot_refreshed'
    );
    return 'refreshed';
  } catch (error) {
    log.warn(
      {
        job: 'provider_snapshot_refresh',
        outcome: 'failure',
        provider: provider.id,
        usage: usage(),
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        durationMs: Date.now() - startedAt
      },
      'provider_snapshot_refresh_failed'
    );
    return 'failed';
  }
}

function scheduleSnapshotRefresh(provider: SnapshotRefresher, log: Logger): () => void {
  if (!provider.live || typeof provider.refreshSnapshot !== 'function') return () => undefined;
  const task = cron.schedule('*/30 * * * *', () => void refreshProviderSnapshotOnce(provider, log), {
    timezone: 'Africa/Nairobi'
  });
  return () => task.stop();
}
