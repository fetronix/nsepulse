import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every integration suite must follow the same skip convention.
 *
 * `vitest.integration.config.ts` promises that without `TEST_DATABASE_URL` the suites skip
 * and are reported as skipped. One file broke that promise: `process-lock.test.ts` ran
 * unconditionally and failed with "expected null not to be null" on any machine without a
 * database, so `npm run test:integration` could not be run at all locally. The setup file
 * cannot enforce this — it runs before the suites are registered — so it is checked here.
 */
const INTEGRATION_DIR = 'tests/integration';
const SETUP_ONLY = new Set(['setup.ts']);

const suites = readdirSync(INTEGRATION_DIR)
  .filter((name) => name.endsWith('.test.ts') && !SETUP_ONLY.has(name))
  .sort();

describe('integration suite conventions', () => {
  it('finds the integration suites', () => {
    // Guards against the check silently passing because it scanned nothing.
    expect(suites.length).toBeGreaterThan(0);
  });

  it('skips each suite when TEST_DATABASE_URL is absent, instead of failing', () => {
    const offenders: string[] = [];
    for (const name of suites) {
      const source = readFileSync(join(INTEGRATION_DIR, name), 'utf8');
      // The accepted shape is `const integration = testUrl ? describe : describe.skip;`
      // followed by `integration(...)` blocks.
      const hasSkipSwitch = /const\s+\w+\s*=\s*testUrl\s*\?\s*describe\s*:\s*describe\.skip\s*;/.test(source);
      const usesSwitch = /\bintegration\(/.test(source);
      const unconditional = /^describe\(/m.test(source);
      if (!hasSkipSwitch || !usesSwitch || unconditional) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
