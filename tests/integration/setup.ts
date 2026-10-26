/**
 * Guard rails for PostgreSQL integration tests.
 *
 * 1. `TEST_DATABASE_URL` must be set; otherwise the suite is reported as skipped.
 * 2. The target database name must look like a disposable test database.
 * 3. It must not be the same database as `DATABASE_URL`.
 *
 * When all three hold, `DATABASE_URL` is pointed at the test database so the
 * application modules under test use it.
 *
 * `REQUIRE_INTEGRATION_TESTS=true` turns a missing `TEST_DATABASE_URL` into a hard failure.
 * CI sets it so that a job which never reaches a database cannot report success on a suite
 * that silently skipped: exiting 0 with every test skipped is indistinguishable from passing
 * unless this guard is enabled.
 */
const testUrl = process.env.TEST_DATABASE_URL;
const requireIntegration = process.env.REQUIRE_INTEGRATION_TESTS === 'true';

if (!testUrl) {
  if (requireIntegration) {
    throw new Error(
      '[integration] REQUIRE_INTEGRATION_TESTS=true but TEST_DATABASE_URL is not set. ' +
        'Refusing to report an all-skipped suite as success.'
    );
  }
  console.warn('[integration] TEST_DATABASE_URL is not set: PostgreSQL integration tests will be skipped, not passed.');
} else {
  let databaseName: string;
  try {
    databaseName = new URL(testUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('[integration] TEST_DATABASE_URL is not a valid PostgreSQL URL.');
  }

  if (!/test/i.test(databaseName)) {
    throw new Error(
      `[integration] Refusing to run against database "${databaseName}": the name must contain "test" to prevent accidental production use.`
    );
  }

  if (process.env.DATABASE_URL && process.env.DATABASE_URL === testUrl) {
    throw new Error('[integration] TEST_DATABASE_URL must differ from DATABASE_URL.');
  }

  process.env.DATABASE_URL = testUrl;
  process.env.DATABASE_SSL = process.env.DATABASE_SSL ?? 'false';
}
