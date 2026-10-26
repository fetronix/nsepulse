import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Environment validation is exercised in a child process because `config.ts` exits the
 * process on invalid input — testing that exit path requires a separate process.
 */
const configModuleUrl = new URL('../../src/server/config.ts', import.meta.url).href;
const script = `
import { config, isDemoMarketDataActive, isNseAdapterConfigured, isDatabaseConfigured, databaseConfig } from ${JSON.stringify(configModuleUrl)};
console.log(JSON.stringify({ config, isDemoMarketDataActive, isNseAdapterConfigured, isDatabaseConfigured, databaseConfig }));
`;

const dir = mkdtempSync(join(tmpdir(), 'nse-config-'));
const scriptPath = join(dir, 'check-config.ts');
writeFileSync(scriptPath, script);

function run(env: Record<string, string | undefined>) {
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) childEnv[key] = value;
  return execFileSync(process.execPath, ['--import', 'tsx', scriptPath], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

describe('environment configuration', () => {
  it('applies documented defaults and keeps the live adapter disabled', () => {
    const parsed = JSON.parse(run({}));
    expect(parsed.config.MARKET_DATA_PROVIDER).toBe('none');
    expect(parsed.config.NODE_ENV).toBe('development');
    expect(parsed.config.PORT).toBe(4000);
    expect(parsed.config.ALLOW_DEMO_MARKET_DATA).toBe('false');
    expect(parsed.config.HISTORICAL_DATA_PERMISSION_CONFIRMED).toBe('false');
    expect(parsed.config.ANNOUNCEMENTS_PERMISSION_CONFIRMED).toBe('false');
    expect(parsed.isDemoMarketDataActive).toBe(false);
    expect(parsed.isNseAdapterConfigured).toBe(false);
    expect(parsed.isDatabaseConfigured).toBe(false);
  });

  it('requires an explicit opt-in before demo fixtures activate', () => {
    expect(JSON.parse(run({ MARKET_DATA_PROVIDER: 'demo' })).isDemoMarketDataActive).toBe(false);
    expect(
      JSON.parse(run({ MARKET_DATA_PROVIDER: 'demo', ALLOW_DEMO_MARKET_DATA: 'true' })).isDemoMarketDataActive
    ).toBe(true);
  });

  it('never activates demo fixtures in production', () => {
    const parsed = JSON.parse(
      run({ NODE_ENV: 'production', MARKET_DATA_PROVIDER: 'demo', ALLOW_DEMO_MARKET_DATA: 'true' })
    );
    expect(parsed.isDemoMarketDataActive).toBe(false);
  });

  it('recognises a configured database', () => {
    expect(JSON.parse(run({ DATABASE_URL: 'postgres://user@localhost:5432/nse' })).isDatabaseConfigured).toBe(true);
  });

  it('composes a connection URL from the SQL_* component variables', () => {
    const parsed = JSON.parse(
      run({
        SQL_HOST: 'db.local',
        SQL_PORT: '5433',
        SQL_DB_NAME: 'nse_pulse',
        SQL_ADMIN_USER: 'pulse',
        SQL_ADMIN_PASSWORD: 'p@ss:w/ord'
      })
    );
    expect(parsed.isDatabaseConfigured).toBe(true);
    // Values are URI-encoded so reserved characters in a generated password cannot corrupt
    // the connection string.
    expect(parsed.config.DATABASE_URL).toBe('postgres://pulse:p%40ss%3Aw%2Ford@db.local:5433/nse_pulse');
    expect(parsed.databaseConfig).toEqual({
      source: 'SQL_*',
      host: 'db.local',
      port: 5433,
      database: 'nse_pulse',
      warning: null
    });
  });

  it('defaults the SQL_* port and tolerates a password-less local server', () => {
    const parsed = JSON.parse(
      run({ SQL_HOST: '127.0.0.1', SQL_DB_NAME: 'nse', SQL_ADMIN_USER: 'postgres', SQL_ADMIN_PASSWORD: '' })
    );
    expect(parsed.config.DATABASE_URL).toBe('postgres://postgres@127.0.0.1:5432/nse');
    expect(parsed.databaseConfig.port).toBe(5432);
  });

  it('prefers DATABASE_URL and says so when both forms are set', () => {
    const parsed = JSON.parse(
      run({
        DATABASE_URL: 'postgres://user@localhost:5432/primary',
        SQL_HOST: 'other-host',
        SQL_DB_NAME: 'other_db',
        SQL_ADMIN_USER: 'other_user'
      })
    );
    expect(parsed.config.DATABASE_URL).toBe('postgres://user@localhost:5432/primary');
    expect(parsed.databaseConfig.source).toBe('DATABASE_URL');
    expect(parsed.databaseConfig.host).toBe('localhost');
    expect(parsed.databaseConfig.warning).toMatch(/DATABASE_URL takes precedence/);
  });

  it('refuses a half-configured SQL_* group instead of silently degrading', () => {
    try {
      run({ SQL_HOST: 'localhost', SQL_ADMIN_PASSWORD: 'secret-value' });
      throw new Error('expected the configuration to be rejected');
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain('SQL_DB_NAME');
      expect(failure.stderr).toContain('SQL_ADMIN_USER');
      // The message names missing keys; it must never echo the value that was supplied.
      expect(failure.stderr).not.toContain('secret-value');
    }
  });

  it('never exposes the password through the non-secret connection description', () => {
    const parsed = JSON.parse(
      run({ SQL_HOST: 'localhost', SQL_DB_NAME: 'nse', SQL_ADMIN_USER: 'postgres', SQL_ADMIN_PASSWORD: 'hunter2' })
    );
    expect(JSON.stringify(parsed.databaseConfig)).not.toContain('hunter2');
  });

  it('rejects an invalid enum and exits non-zero with field errors', () => {
    expect(() => run({ NODE_ENV: 'staging', PORT: '0' })).toThrow();
    try {
      run({ NODE_ENV: 'staging' });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain('Invalid environment configuration');
      expect(failure.stderr).toContain('NODE_ENV');
    }
  });

  it('rejects a malformed vendor base URL rather than passing it through', () => {
    expect(() => run({ NSE_VENDOR_API_BASE_URL: 'not-a-url' })).toThrow();
  });

  it('accepts every documented pino level and rejects unknown log levels', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']) {
      expect(JSON.parse(run({ LOG_LEVEL: level })).config.LOG_LEVEL).toBe(level);
    }
    expect(() => run({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});
