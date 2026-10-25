import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * Operator scripts are exercised in child processes so their real exit codes and stderr
 * are verified. None of these cases can reach a database: they cover the refusal paths
 * that protect against running migrations or imports without configuration.
 */
async function runScript(script: string, args: string[] = [], env: Record<string, string | undefined> = {}) {
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) childEnv[key] = value;
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: process.cwd(),
      env: childEnv,
      encoding: 'utf8'
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('db:check script', () => {
  it('exits non-zero and explains the missing configuration', async () => {
    const result = await runScript('src/server/db/check.ts', [], { DATABASE_URL: undefined });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('"configured": false');
    expect(result.stdout).toContain('DATABASE_URL is not configured');
  });
});

describe('db:migrate script', () => {
  it('refuses to run without DATABASE_URL', async () => {
    const result = await runScript('src/server/db/migrate.ts', [], { DATABASE_URL: undefined });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL is required for migrations');
  });

  it('reports a migration failure without leaking credentials', async () => {
    const result = await runScript('src/server/db/migrate.ts', [], {
      DATABASE_URL: 'postgres://user:supersecret@127.0.0.1:1/nse_test'
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Migration failed');
    expect(`${result.stdout}${result.stderr}`).not.toContain('supersecret');
  });
});

describe('security master importer', () => {
  it('prints usage and exits non-zero when arguments are missing', async () => {
    const result = await runScript('src/server/db/import-securities.ts', [], { DATABASE_URL: undefined });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Usage: SECURITY_MASTER_SOURCE_URL');
  });

  it('refuses a non-official source host before touching the database', async () => {
    const result = await runScript('src/server/db/import-securities.ts', ['does-not-exist.csv'], {
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/nse_test',
      SECURITY_MASTER_SOURCE_URL: 'https://example.com/list.csv',
      SECURITY_MASTER_VERIFIED_AT: '2026-10-25T09:00:00Z'
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('HTTPS NSE or CDSC');
  });

  it('refuses an invalid verification timestamp', async () => {
    const result = await runScript('src/server/db/import-securities.ts', ['does-not-exist.csv'], {
      DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/nse_test',
      SECURITY_MASTER_SOURCE_URL: 'https://www.nse.co.ke/list.csv',
      SECURITY_MASTER_VERIFIED_AT: 'not-a-date'
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ISO timestamp');
  });
});

describe('standalone bot process', () => {
  it('refuses to start without a bot token', async () => {
    const result = await runScript('src/server/telegram/standalone.ts', [], { TELEGRAM_BOT_TOKEN: undefined });
    expect(result.code).not.toBe(0);
    expect(`${result.stderr}`).toContain('TELEGRAM_BOT_TOKEN is required');
  });
});
