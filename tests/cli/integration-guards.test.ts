import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/**
 * Regression tests for the "skipped is not passed" guards around the PostgreSQL
 * integration suite.
 *
 * `vitest run` exits 0 when every test is skipped, so a CI job that never reached its
 * database could report success without executing anything. Two guards prevent that:
 *
 * 1. `tests/integration/setup.ts` fails hard when `REQUIRE_INTEGRATION_TESTS=true` and
 *    `TEST_DATABASE_URL` is absent.
 * 2. `scripts/assert-integration-ran.mjs` fails unless the machine-readable report shows a
 *    minimum number of passed tests.
 */

const setupModule = new URL('../integration/setup.ts', import.meta.url).pathname;

async function runSetup(env: Record<string, string | undefined>) {
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) childEnv[key] = value;
  try {
    const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', setupModule], {
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

describe('integration setup guard', () => {
  it('warns but does not fail without TEST_DATABASE_URL when the guard is off', async () => {
    const result = await runSetup({ TEST_DATABASE_URL: undefined, REQUIRE_INTEGRATION_TESTS: undefined });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('will be skipped, not passed');
  });

  it('fails hard without TEST_DATABASE_URL when REQUIRE_INTEGRATION_TESTS=true', async () => {
    const result = await runSetup({ TEST_DATABASE_URL: undefined, REQUIRE_INTEGRATION_TESTS: 'true' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('REQUIRE_INTEGRATION_TESTS=true but TEST_DATABASE_URL is not set');
  });

  it('refuses a database whose name does not look disposable', async () => {
    const result = await runSetup({
      TEST_DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/production_pulse',
      REQUIRE_INTEGRATION_TESTS: 'true'
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('must contain "test"');
  });

  it('rejects a malformed TEST_DATABASE_URL', async () => {
    const result = await runSetup({ TEST_DATABASE_URL: 'not-a-url', REQUIRE_INTEGRATION_TESTS: 'true' });
    expect(result.code).toBe(1);
  });
});

describe('integration report assertion', () => {
  const script = 'scripts/assert-integration-ran.mjs';
  const dir = mkdtempSync(join(tmpdir(), 'nse-integration-report-'));

  function writeReport(name: string, report: unknown) {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(report));
    return path;
  }

  async function assertReport(path: string) {
    try {
      const { stdout } = await run(process.execPath, [script, path], { cwd: process.cwd(), encoding: 'utf8' });
      return { code: 0, stdout };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
  }

  it('passes when the report shows passed tests', async () => {
    const path = writeReport('passed.json', {
      numTotalTests: 7,
      numPassedTests: 7,
      numFailedTests: 0,
      numPendingTests: 0
    });
    const result = await assertReport(path);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Integration assertion passed');
  });

  it('fails when every test was skipped, even though vitest exits 0', async () => {
    const path = writeReport('skipped.json', {
      numTotalTests: 7,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 7
    });
    const result = await assertReport(path);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('A suite that skips is not a suite that passes');
  });

  it('fails when fewer tests passed than the documented minimum', async () => {
    const path = writeReport('partial.json', {
      numTotalTests: 7,
      numPassedTests: 2,
      numFailedTests: 0,
      numPendingTests: 5
    });
    const result = await assertReport(path);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('expected at least 7');
  });

  it('fails when the report records a failure', async () => {
    const path = writeReport('failed.json', {
      numTotalTests: 7,
      numPassedTests: 6,
      numFailedTests: 1,
      numPendingTests: 0
    });
    const result = await assertReport(path);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Integration assertion failed');
  });

  it('fails with a clear message when the report is missing', async () => {
    const result = await assertReport(join(dir, 'does-not-exist.json'));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cannot read report');
  });
});
