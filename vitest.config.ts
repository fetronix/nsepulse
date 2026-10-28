import { defineConfig } from 'vitest/config';

/**
 * Unit/integration test configuration for Vitest.
 *
 * Coverage measures every TypeScript source file under `src/`, including files that
 * no test imports, so an untested module counts as uncovered rather than disappearing
 * from the report. The schema modules (`src/server/db/schema.ts` and
 * `src/server/db/schema/`) are excluded because they contain only declarative Drizzle table
 * definitions with no executable business logic.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/integration/**', 'node_modules/**', 'dist/**'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/server/db/schema.ts', 'src/server/db/schema/**', 'src/server/index.ts'],
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70
      }
    }
  }
});
