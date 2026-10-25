import cron from 'node-cron';
import { config } from '../config.js';
import { withAdvisoryLock } from '../db/client.js';
import { ProviderRegistry } from '../providers/types.js';

const jobs = new ProviderRegistry();
/** Retry helper for idempotent background work; exponential backoff with bounded delay. */
export async function retry<T>(task: () => Promise<T>, attempts = 3, initialDelayMs = 250): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await task(); }
    catch (error) { lastError = error; if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, Math.min(initialDelayMs * 2 ** attempt, 5000))); }
  }
  throw lastError;
}
/** Operational heartbeat only. No data polling is scheduled until an authorized adapter exists. */
export function startScheduler() {
  if (config.ENABLE_SCHEDULER !== 'true' || !config.DATABASE_URL) {
    console.log(JSON.stringify({ level: 'info', event: 'scheduler_disabled', reason: !config.DATABASE_URL ? 'DATABASE_URL not configured' : 'ENABLE_SCHEDULER is not true' }));
    return () => undefined;
  }
  const task = cron.schedule('*/5 * * * *', async () => {
    try {
      await withAdvisoryLock(814_782_025, async () => {
        const statuses = await retry(() => jobs.statuses());
        console.log(JSON.stringify({ level: 'info', event: 'provider_health_check', providers: statuses.map(s => ({ provider: s.provider, state: s.state, dataMode: s.dataMode })), timestamp: new Date().toISOString() }));
      });
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', event: 'provider_health_check_failed', message: error instanceof Error ? error.message : 'unknown' }));
    }
  }, { timezone: 'Africa/Nairobi' });
  return () => task.stop();
}
