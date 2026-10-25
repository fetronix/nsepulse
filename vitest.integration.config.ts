import { defineConfig } from 'vitest/config';

/**
 * PostgreSQL integration tests.
 *
 * These require a disposable database supplied through TEST_DATABASE_URL and never run
 * as part of the default `npm test` command, so a unit-test run can never mutate a
 * developer or production database. When TEST_DATABASE_URL is absent every suite skips
 * with an explicit message; skipped suites are reported as skipped, not passing.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
    reporters: ['default']
  }
});
