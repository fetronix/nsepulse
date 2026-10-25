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
  return () => task.stop();
}
