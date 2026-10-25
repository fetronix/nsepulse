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

beforeEach(() => {
  scheduledTasks.length = 0;
  lockCalls.length = 0;
  lockBehaviour = 'run';
  stopSpy.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    const stop = runner.startScheduler();
    expect(scheduledTasks).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });

  it('does not schedule when no database is configured', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: undefined });
    runner.startScheduler();
    expect(scheduledTasks).toHaveLength(0);
  });

  it('schedules one in-process heartbeat under an advisory lock', async () => {
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://localhost/nse_test' });
    const stop = runner.startScheduler();
    expect(scheduledTasks).toHaveLength(1);
    expect(scheduledTasks[0]?.cron).toBe('*/5 * * * *');
    expect(scheduledTasks[0]?.options).toEqual({ timezone: 'Africa/Nairobi' });

    await scheduledTasks[0]!.handler();
    expect(lockCalls).toHaveLength(1);
    const logged = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls.flat().join(' ');
    expect(logged).toContain('provider_health_check');

    stop();
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it('skips work when the advisory lock is held elsewhere', async () => {
    lockBehaviour = 'skip';
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://localhost/nse_test' });
    runner.startScheduler();
    await scheduledTasks[0]!.handler();
    const logged = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls.flat().join(' ');
    expect(logged).not.toContain('provider_health_check');
  });

  it('logs a structured error when the heartbeat fails', async () => {
    lockBehaviour = 'throw';
    const runner = await loadRunner({ ENABLE_SCHEDULER: 'true', DATABASE_URL: 'postgres://localhost/nse_test' });
    runner.startScheduler();
    await scheduledTasks[0]!.handler();
    const logged = (console.error as unknown as { mock: { calls: string[][] } }).mock.calls.flat().join(' ');
    expect(logged).toContain('provider_health_check_failed');
  });
});
