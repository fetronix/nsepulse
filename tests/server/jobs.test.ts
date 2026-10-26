import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scheduler and retry behaviour. `node-cron` and the advisory-lock helper are mocked so
 * these tests never schedule real work or require PostgreSQL.
 */
const scheduledTasks: { cron: string; handler: () => Promise<void>; options: unknown }[] = [];
const stopSpy = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: (cron: string, handler: () => Promise<void>, options: unknown) => {
      scheduledTasks.push({ cron, handler, options });
      return { stop: stopSpy };
    }
  }
}));

let lockBehaviour: 'run' | 'skip' | 'throw' = 'run';
const lockCalls: number[] = [];

vi.mock('../../src/server/db/client.js', () => ({
  withAdvisoryLock: vi.fn(async (key: number, work: () => Promise<unknown>) => {
    lockCalls.push(key);
    if (lockBehaviour === 'throw') throw new Error('lock acquisition failed');
    if (lockBehaviour === 'skip') return null;
    return work();
  })
}));

const ORIGINAL_ENV = { ...process.env };

async function loadRunner(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('../../src/server/jobs/runner.js');
}

type LogFn = (fields: Record<string, unknown>, message: string) => void;

/** Minimal logger double that records structured fields and messages. */
class FakeLogger {
  readonly info = vi.fn<LogFn>();
  readonly error = vi.fn<LogFn>();
  readonly warn = vi.fn<LogFn>();
  readonly debug = vi.fn<LogFn>();
}

let logger: FakeLogger;

beforeEach(() => {
  scheduledTasks.length = 0;
  lockCalls.length = 0;
  lockBehaviour = 'run';
  stopSpy.mockClear();
  logger = new FakeLogger();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('retry helper', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    const runner = await loadRunner({});
    const task = vi.fn(async () => 'ok');
    await expect(runner.retry(task)).resolves.toBe('ok');
    expect(task).toHaveBeenCalledOnce();
  });

  it('retries transient failures and eventually succeeds', async () => {
    const runner = await loadRunner({});
    const task = vi.fn().mockRejectedValueOnce(new Error('first')).mockResolvedValueOnce('second');
    await expect(runner.retry(task, 3, 1)).resolves.toBe('second');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('throws the last error once attempts are exhausted', async () => {
    const runner = await loadRunner({});
    const task = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(runner.retry(task, 2, 1)).rejects.toThrow('always fails');
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe('scheduler', () => {
  it('does not schedule anything when disabled', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'false', DATABASE_URL: 'postgres://localhost/nse' });
    const stop = runner.startScheduler({ logger: logger as never });
    expect(scheduledTasks).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });

  it('does not schedule when no database is configured', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: undefined });
    runner.startScheduler({ logger: logger as never });
    expect(scheduledTasks).toHaveLength(0);
  });

  it('schedules one in-process heartbeat under an advisory lock', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://localhost/nse_test' });
    const stop = runner.startScheduler({ logger: logger as never });
    expect(scheduledTasks).toHaveLength(1);
    expect(scheduledTasks[0]?.cron).toBe('*/5 * * * *');
    expect(scheduledTasks[0]?.options).toEqual({ timezone: 'Africa/Nairobi' });

    await scheduledTasks[0]!.handler();
    expect(lockCalls).toHaveLength(1);
    const [fields, message] = logger.info.mock.calls[0]!;
    expect(message).toBe('provider_health_check');
    expect(fields).toMatchObject({ job: 'provider_health_check', outcome: 'success' });

    stop();
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it('skips work when the advisory lock is held elsewhere', async () => {
    lockBehaviour = 'skip';
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://localhost/nse_test' });
    runner.startScheduler({ logger: logger as never });
    await scheduledTasks[0]!.handler();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a structured error when the heartbeat fails', async () => {
    lockBehaviour = 'throw';
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://localhost/nse_test' });
    runner.startScheduler({ logger: logger as never });
    await scheduledTasks[0]!.handler();
    const [fields, message] = logger.error.mock.calls[0]!;
    expect(message).toBe('provider_health_check_failed');
    expect(fields).toMatchObject({ job: 'provider_health_check', outcome: 'failure', errorClass: 'Error' });
  });
});

describe('provider snapshot refresh', () => {
  /** A live adapter with the snapshot contract, as the Mansa adapter has. */
  function refresher(overrides: Partial<{ live: boolean; refreshSnapshot?: () => Promise<number> }> = {}) {
    return {
      id: 'mansa',
      live: true,
      refreshSnapshot: vi.fn(async () => 12),
      usage: () => ({ used: 7, budget: 100 }),
      ...overrides
    };
  }

  it('refreshes once under the refresh lock and logs the record count', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://x@h/db' });
    const provider = refresher();
    await expect(runner.refreshProviderSnapshotOnce(provider, logger as never)).resolves.toBe('refreshed');
    expect(provider.refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(lockCalls).toEqual([814_782_026]);
    const [fields, message] = logger.info.mock.calls.at(-1) ?? [];
    expect(message).toBe('provider_snapshot_refreshed');
    expect(fields).toMatchObject({ outcome: 'success', records: 12 });
  });

  it('skips when another replica holds the lock instead of refreshing twice', async () => {
    lockBehaviour = 'skip';
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://x@h/db' });
    const provider = refresher();
    await expect(runner.refreshProviderSnapshotOnce(provider, logger as never)).resolves.toBe('skipped');
    expect(provider.refreshSnapshot).not.toHaveBeenCalled();
    expect(logger.info.mock.calls.at(-1)?.[1]).toBe('provider_snapshot_refresh_skipped');
  });

  it('contains a database failure while taking the lock instead of rejecting', async () => {
    // Regression: this await used to sit outside the try/catch, so a storage blip became an
    // unhandled promise rejection from a cron callback.
    lockBehaviour = 'throw';
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://x@h/db' });
    await expect(runner.refreshProviderSnapshotOnce(refresher(), logger as never)).resolves.toBe('failed');
    const [fields, message] = logger.warn.mock.calls.at(-1) ?? [];
    expect(message).toBe('provider_snapshot_refresh_failed');
    expect(fields).toMatchObject({ errorClass: 'Error' });
  });

  it('contains a provider failure and still reports the quota usage', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://x@h/db' });
    const provider = refresher({
      refreshSnapshot: vi.fn(async () => {
        throw new Error('upstream 429');
      })
    });
    await expect(runner.refreshProviderSnapshotOnce(provider, logger as never)).resolves.toBe('failed');
    const [fields] = logger.warn.mock.calls.at(-1) ?? [];
    expect(fields).toMatchObject({ usage: { used: 7, budget: 100 }, errorMessage: 'upstream 429' });
  });

  it('never calls a non-live or non-Mansa adapter', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://x@h/db' });
    await expect(
      runner.refreshProviderSnapshotOnce({ id: 'nse-authorized-feed', live: false }, logger as never)
    ).resolves.toBe('skipped');
    // A live adapter without the snapshot method must not be cast and called anyway.
    await expect(runner.refreshProviderSnapshotOnce({ id: 'other-live', live: true }, logger as never)).resolves.toBe(
      'skipped'
    );
    expect(lockCalls).toEqual([]);
  });

  it('survives a usage() that throws while logging the failure', async () => {
    lockBehaviour = 'throw';
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://x@h/db' });
    const provider = {
      id: 'mansa',
      live: true,
      refreshSnapshot: vi.fn(async () => 0),
      usage: () => {
        throw new Error('usage exploded');
      }
    };
    await expect(runner.refreshProviderSnapshotOnce(provider, logger as never)).resolves.toBe('failed');
    expect(logger.warn.mock.calls.at(-1)?.[0]).toMatchObject({ usage: null });
  });
});
