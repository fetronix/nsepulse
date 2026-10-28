import { describe, expect, it } from 'vitest';
import {
  LOCAL_TEST_DATABASE_URL,
  TEST_SERVICE,
  main,
  preflight,
  startTestDatabase,
  stopTestDatabase
} from '../../scripts/integration-local.js';

/**
 * Orchestration of the local integration workflow, tested with an injected command runner.
 *
 * Docker is not available in the test environment and must not be required by a unit test,
 * so every assertion here is about the decisions the script makes: which commands it runs,
 * in what order, with what environment, and what it refuses to do.
 */

type Call = { command: string; args: string[]; env?: NodeJS.ProcessEnv };
type Handler = (call: Call) => { status: number; stdout?: string; stderr?: string };

/**
 * Records calls and answers them with a handler. The default pretends everything succeeds
 * *and* that the compose file declares the test service, so tests only describe the
 * behaviour they are about.
 */
function fakeRunner(handler?: Handler, { interceptProbes = true }: { interceptProbes?: boolean } = {}) {
  const calls: Call[] = [];
  const respond = (call: Call) => {
    // Preflight probes always succeed, so a test that simulates a failing step does not
    // accidentally simulate a broken environment instead.
    const isProbe =
      call.command === 'docker' &&
      (call.args[0] === '--version' || call.args[1] === 'version' || call.args.includes('--services'));
    if (isProbe && interceptProbes) {
      return call.args.includes('--services') ? { status: 0, stdout: `db\napp\n${TEST_SERVICE}\n` } : { status: 0 };
    }
    return handler ? handler(call) : { status: 0 };
  };
  const run = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv; capture?: boolean } = {}) => {
    const call = { command, args, env: options.env };
    calls.push(call);
    return respond(call);
  };
  return { run, calls };
}

const quiet = () => undefined;

describe('preflight', () => {
  it('refuses to continue when Docker is unavailable, and explains the manual path', () => {
    const messages: string[] = [];
    const { run, calls } = fakeRunner(
      ({ command, args }) => (command === 'docker' && args[0] === '--version' ? { status: 127 } : { status: 0 }),
      { interceptProbes: false }
    );
    expect(() => preflight(run, (line: string) => messages.push(line))).toThrow(/docker unavailable/);
    // Only the probe ran: nothing was started.
    expect(calls).toHaveLength(1);
    expect(messages.join('\n')).toContain('test:integration:verified');
  });

  it('requires the Compose v2 plugin separately from Docker itself', () => {
    const { run } = fakeRunner(({ args }) => (args[0] === 'compose' ? { status: 1 } : { status: 0 }), {
      interceptProbes: false
    });
    expect(() => preflight(run, quiet)).toThrow(/compose unavailable/);
  });

  it('rejects a compose file without the test service instead of failing later', () => {
    const { run } = fakeRunner(
      ({ args }) => (args.includes('--services') ? { status: 0, stdout: 'db\napp\n' } : { status: 0 }),
      { interceptProbes: false }
    );
    expect(() => preflight(run, quiet)).toThrow(/test service missing/);
  });

  it('passes when the service is declared', () => {
    const { run } = fakeRunner(
      ({ args }) => (args.includes('--services') ? { status: 0, stdout: `db\napp\n${TEST_SERVICE}\n` } : { status: 0 }),
      { interceptProbes: false }
    );
    expect(() => preflight(run, quiet)).not.toThrow();
  });
});

describe('container lifecycle', () => {
  it('starts only the test service, with the test profile', () => {
    const { run, calls } = fakeRunner();
    startTestDatabase(run, quiet);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['compose', '--profile', 'test', 'up', '-d', '--wait', TEST_SERVICE]);
  });

  it('falls back to polling pg_isready when `up --wait` is not supported', () => {
    let probe = 0;
    const { run, calls } = fakeRunner(({ args }) => {
      if (args.includes('--wait')) return { status: 1, stderr: 'unknown flag: --wait' };
      if (args.includes('pg_isready')) return { status: probe++ === 0 ? 1 : 0 };
      return { status: 0 };
    });
    startTestDatabase(run, quiet);
    expect(calls[0]!.args).toContain('--wait');
    expect(calls[1]!.args).toContain('up');
    expect(calls[1]!.args).not.toContain('--wait');
    expect(calls.slice(2).every((call) => call.args.includes('pg_isready'))).toBe(true);
  });

  it('removes only its own container — never `down`, never `-v`', () => {
    const { run, calls } = fakeRunner();
    expect(stopTestDatabase(run, quiet)).toBe(true);
    const flat = calls.map((call) => call.args.join(' ')).join('\n');
    expect(calls[0]!.args).toEqual(['compose', '--profile', 'test', 'rm', '-sf', TEST_SERVICE]);
    expect(flat).not.toMatch(/\bdown\b/);
    expect(flat).not.toMatch(/\s-v\b/);
  });

  it('reports a cleanup failure without throwing', () => {
    const messages: string[] = [];
    const { run } = fakeRunner(() => ({ status: 1 }));
    expect(stopTestDatabase(run, (line: string) => messages.push(line))).toBe(false);
    expect(messages.join('\n')).toContain('rm -sf db-test');
  });
});

describe('main', () => {
  it('runs migrate then the verified suite with the disposable URL', () => {
    const { run, calls } = fakeRunner();
    const logs: string[] = [];
    const code = main({ run, log: (line: string) => logs.push(line), err: quiet });

    expect(code).toBe(0);
    const npmCalls = calls.filter((call) => call.command === 'npm');
    expect(npmCalls.map((call) => call.args[1])).toEqual(['db:migrate', 'test:integration:verified']);
    for (const call of npmCalls) expect(call.env?.TEST_DATABASE_URL).toBe(LOCAL_TEST_DATABASE_URL);
    // The suite must be forced to fail rather than skip.
    expect(npmCalls[1]!.env?.REQUIRE_INTEGRATION_TESTS).toBe('true');
    // A developer's DATABASE_URL must not leak into the run.
    for (const call of npmCalls) expect(call.env?.DATABASE_URL ?? '').not.toMatch(/nse_pulse(?!_test)/);
  });

  it('does not run the suite when migrations fail', () => {
    const { run, calls } = fakeRunner((call) =>
      call.command === 'npm' && call.args[1] === 'db:migrate' ? { status: 1 } : { status: 0 }
    );
    expect(main({ run, log: quiet, err: quiet })).toBe(1);
    expect(calls.filter((call) => call.command === 'npm').map((call) => call.args[1])).toEqual(['db:migrate']);
    // Cleanup still happened.
    expect(calls.at(-1)!.args).toContain('rm');
  });

  it('propagates a failing suite and still cleans up', () => {
    const { run, calls } = fakeRunner((call) =>
      call.command === 'npm' && call.args[1] === 'test:integration:verified' ? { status: 1 } : { status: 0 }
    );
    expect(main({ run, log: quiet, err: quiet })).toBe(1);
    expect(calls.at(-1)!.args).toContain('rm');
  });

  it('leaves the container running when --keep is set', () => {
    const { run, calls } = fakeRunner();
    expect(main({ run, log: quiet, err: quiet, keep: true })).toBe(0);
    expect(calls.some((call) => call.args.includes('rm'))).toBe(false);
  });

  it('does not remove a container it never started', () => {
    const { run, calls } = fakeRunner(() => ({ status: 1 }));
    expect(main({ run, log: quiet, err: quiet })).toBe(1);
    // Preflight failed, so nothing other than the probes ran.
    expect(calls.some((call) => call.args.includes('rm'))).toBe(false);
  });

  it('a cleanup failure does not turn a passing run into a failure', () => {
    const { run } = fakeRunner((call) => (call.args.includes('rm') ? { status: 1 } : { status: 0 }));
    expect(main({ run, log: quiet, err: quiet })).toBe(0);
  });

  it('uses a test-suffixed database name, which the suite guard requires', () => {
    expect(new URL(LOCAL_TEST_DATABASE_URL).pathname).toBe('/nse_pulse_test');
    expect(LOCAL_TEST_DATABASE_URL).toMatch(/127\.0\.0\.1:5433/);
  });
});

describe('safety of the documented URL', () => {
  it('never targets a host outside loopback', () => {
    const { hostname } = new URL(LOCAL_TEST_DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '::1']).toContain(hostname);
  });

  it('is not used by the application service in compose', async () => {
    const { readFileSync } = await import('node:fs');
    const compose = readFileSync('docker-compose.yml', 'utf8');
    // Comment lines legitimately mention the test URL as documentation, so only real
    // assignments count.
    const assignments = compose
      .split('\n')
      .filter((line) => !line.trim().startsWith('#') && line.includes('DATABASE_URL:'))
      .join('\n');
    expect(assignments).toContain('DATABASE_URL: postgres://nse_pulse');
    expect(assignments).not.toContain('nse_pulse_test');
  });
});
