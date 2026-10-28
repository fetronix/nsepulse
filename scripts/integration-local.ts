#!/usr/bin/env node
/**
 * One-command local integration run against a disposable PostgreSQL container.
 *
 * The pieces already existed but were only documented as a sequence of manual steps, which
 * is exactly the kind of workflow people skip. This wires them together:
 *
 *   1. verify Docker and Compose are usable, and that the compose file declares `db-test`
 *   2. start `db-test` only (`--profile test`), wait until it reports ready
 *   3. apply migrations to that database
 *   4. run `test:integration:verified`, which fails when the suite skips instead of running
 *   5. remove the `db-test` container, leaving every other service and volume untouched
 *
 * Cleanup deliberately uses `rm -sf db-test` rather than `down`: `down` stops the whole
 * project (including a developer's `db` and `app`) and `down -v` would delete the named
 * `postgres-data` volume. Losing a local database to a test command is not acceptable.
 *
 * Usage:
 *   npm run test:integration:local           # run and clean up
 *   npm run test:integration:local -- --keep # leave the container running for debugging
 *
 * The orchestration is exported so it can be unit tested with an injected command runner;
 * Docker is never required to test this file.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Result shape shared by the real runner and the test doubles. */
export interface RunResult {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
}

export type RunOptions = { env?: NodeJS.ProcessEnv; capture?: boolean };
export type Runner = (command: string, args: string[], options?: RunOptions) => RunResult;
export type Log = (line: string) => void;

/** Fixed URL of the compose `db-test` service. Credentials are local-only placeholders. */
export const LOCAL_TEST_DATABASE_URL = 'postgres://nse_pulse_test:test_only@127.0.0.1:5433/nse_pulse_test';

/** Container the script owns. Nothing else is started, stopped or removed. */
export const TEST_SERVICE = 'db-test';
const COMPOSE = (args: string[]): string[] => ['compose', '--profile', 'test', ...args];

/**
 * Default runner: synchronous child process, inheriting stdio for long steps so the user
 * sees live output, capturing it for short probes.
 */
export function defaultRunner(): Runner {
  return (command, args, options = {}) =>
    spawnSync(command, args, {
      env: options.env ?? process.env,
      encoding: 'utf8',
      stdio: options.capture ? 'pipe' : 'inherit'
    });
}

export class PreflightError extends Error {}

/**
 * Fail before changing anything if the environment cannot run the workflow.
 *
 * Each message says what to do instead, because the most likely reasons are "Docker is not
 * installed" and "you are in a container/CI image without a daemon".
 */
export function preflight(run: Runner, log: Log = (line) => console.error(line)): void {
  const docker = run('docker', ['--version'], { capture: true });
  if (docker.status !== 0) {
    log('✖ Docker is not available (or the daemon is not running).');
    log('  Start Docker, or run the steps manually against any PostgreSQL 16 instance:');
    log('    TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/name_test npm run test:integration:verified');
    throw new PreflightError('docker unavailable');
  }

  const compose = run('docker', ['compose', 'version'], { capture: true });
  if (compose.status !== 0) {
    log('✖ `docker compose` (v2) is not available. Install the Compose plugin.');
    throw new PreflightError('compose unavailable');
  }

  if (!existsSync('docker-compose.yml')) {
    log('✖ docker-compose.yml was not found. Run this from the repository root.');
    throw new PreflightError('compose file missing');
  }

  // A typo in the service name would otherwise surface as a confusing "no such service".
  const services = run('docker', COMPOSE(['config', '--services', '--profile', 'test']), { capture: true });
  if (services.status === 0 && !String(services.stdout ?? '').includes(TEST_SERVICE)) {
    log(`✖ docker-compose.yml does not declare a "${TEST_SERVICE}" service.`);
    throw new PreflightError('test service missing');
  }
}

/**
 * Start the test database and wait for it to accept connections.
 *
 * `up --wait` needs Compose 2.17+. When it is unavailable (older plugin, or `--wait` not
 * recognised) the start is retried without it and readiness is polled with `pg_isready`
 * inside the container, which is the same check the healthcheck uses.
 */
export function startTestDatabase(run: Runner, log: Log = (line) => console.log(line)): void {
  const waited = run('docker', COMPOSE(['up', '-d', '--wait', TEST_SERVICE]));
  if (waited.status === 0) {
    log(`✔ ${TEST_SERVICE} is up and healthy.`);
    return;
  }

  log(`… \`up --wait\` was not accepted, falling back to polling pg_isready.`);
  const started = run('docker', COMPOSE(['up', '-d', TEST_SERVICE]));
  if (started.status !== 0) throw new Error(`could not start ${TEST_SERVICE}`);

  const deadline = Date.now() + 60_000;
  for (;;) {
    const ready = run(
      'docker',
      COMPOSE(['exec', '-T', TEST_SERVICE, 'pg_isready', '-U', 'nse_pulse_test', '-d', 'nse_pulse_test']),
      { capture: true }
    );
    if (ready.status === 0) {
      log(`✔ ${TEST_SERVICE} is ready.`);
      return;
    }
    if (Date.now() > deadline) throw new Error(`${TEST_SERVICE} did not become ready within 60s`);
    // Small synchronous pause: the runner contract is synchronous so this stays testable.
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { stdio: 'ignore' });
  }
}

/** Remove only the container this script started. Other services and volumes are untouched. */
export function stopTestDatabase(run: Runner, log: Log = (line) => console.log(line)): boolean {
  const removed = run('docker', COMPOSE(['rm', '-sf', TEST_SERVICE]), { capture: true });
  if (removed.status === 0) {
    log(`✔ ${TEST_SERVICE} removed.`);
    return true;
  }
  log(`! Could not remove ${TEST_SERVICE}; remove it with: docker compose --profile test rm -sf ${TEST_SERVICE}`);
  return false;
}

/**
 * Run the whole workflow.
 *
 * Returns a process exit code. The suite's exit code is authoritative: a cleanup problem
 * never turns a failed test run into a success, and never hides it either.
 */
export function main({
  run = defaultRunner(),
  log = (line: string) => console.log(line),
  err = (line: string) => console.error(line),
  keep = false
}: { run?: Runner; log?: Log; err?: Log; keep?: boolean } = {}): number {
  try {
    preflight(run, err);
  } catch {
    return 1;
  }

  const testEnv = {
    ...process.env,
    TEST_DATABASE_URL: LOCAL_TEST_DATABASE_URL,
    // Never inherit a developer DATABASE_URL: the guard rejects an identical URL, and more
    // importantly the suite must not be able to reach a real database by accident.
    DATABASE_URL: '',
    DATABASE_SSL: 'false'
  };

  // Assigned on every path: the try's two branches and the catch.
  let exitCode: number;
  let started = false;
  try {
    startTestDatabase(run, log);
    started = true;

    log('→ Applying migrations to the disposable database…');
    const migrated = run('npm', ['run', 'db:migrate'], {
      env: { ...testEnv, DATABASE_URL: LOCAL_TEST_DATABASE_URL }
    });
    if (migrated.status !== 0) {
      err('✖ Migrations failed; not running the suite.');
      exitCode = 1;
    } else {
      log('→ Running the integration suite…');
      const suite = run('npm', ['run', 'test:integration:verified'], {
        env: { ...testEnv, REQUIRE_INTEGRATION_TESTS: 'true' }
      });
      exitCode = suite.status === 0 ? 0 : 1;
    }
  } catch (error) {
    err(`✖ ${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  } finally {
    if (!started) {
      // Nothing was started; do not remove a container we do not own.
    } else if (keep) {
      log(`… --keep set: leaving ${TEST_SERVICE} running. Stop it later with:`);
      log(`    docker compose --profile test rm -sf ${TEST_SERVICE}`);
    } else {
      stopTestDatabase(run, log);
    }
  }

  return exitCode;
}

// Execute only when run as a program (tsx scripts/integration-local.ts), never on import.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main({ keep: process.argv.includes('--keep') });
}
