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
import { config, isDemoMarketDataActive, isNseAdapterConfigured, isDatabaseConfigured } from ${JSON.stringify(configModuleUrl)};
console.log(JSON.stringify({ config, isDemoMarketDataActive, isNseAdapterConfigured, isDatabaseConfigured }));
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
