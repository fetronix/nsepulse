#!/usr/bin/env node
/**
 * Fail unless the integration suite actually executed tests.
 *
 * `vitest run` exits 0 when every test is skipped, so a CI job that never reached its
 * database would still report success. This script reads the machine-readable report and
 * asserts a minimum number of *passed* tests, which makes "skipped everything" a failure.
 *
 * Usage: node scripts/assert-integration-ran.mjs [report.json] [minPassed]
 * Defaults: test-results/integration.json, 7
 */
import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'test-results/integration.json';
const minPassed = Number(process.argv[3] ?? 7);

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  console.error(`Integration assertion failed: cannot read report "${reportPath}".`);
  console.error(String(error));
  process.exit(1);
}

const numPassedTests = report.numPassedTests ?? 0;
const numFailedTests = report.numFailedTests ?? 0;
const numPendingTests = report.numPendingTests ?? 0;
const numTotalTests = report.numTotalTests ?? 0;

const summary =
  `total ${numTotalTests}, passed ${numPassedTests}, failed ${numFailedTests}, ` + `pending/skipped ${numPendingTests}`;

if (numFailedTests > 0) {
  console.error(`Integration assertion failed: ${summary}.`);
  process.exit(1);
}

if (numPassedTests < minPassed) {
  console.error(
    `Integration assertion failed: only ${numPassedTests} test(s) passed, expected at least ${minPassed} (${summary}).`
  );
  console.error(
    'A suite that skips is not a suite that passes. Check TEST_DATABASE_URL, the PostgreSQL ' +
      'service container and REQUIRE_INTEGRATION_TESTS.'
  );
  process.exit(1);
}

console.log(`Integration assertion passed: ${summary} (>= ${minPassed} passed, 0 failed).`);
