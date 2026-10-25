import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every environment variable the code reads must be documented in `.env.example`.
 *
 * Adding `MIGRATIONS_FOLDER` to the migration runner without documenting it is exactly the
 * kind of drift that makes a deployment guess at configuration. This test walks the source
 * (and the container entrypoint) for `process.env.*` reads and compares the set against the
 * keys documented in `.env.example`.
 *
 * Only one direction is enforced: `.env.example` may document variables that the application
 * itself does not read (for example `POSTGRES_PASSWORD`, consumed by Docker Compose), but the
 * code must not read an undocumented one.
 */

const SCAN_ROOTS = ['src', 'scripts', 'docker'];
const CODE_EXTENSIONS = /\.(ts|tsx|mjs|cjs|js|sh)$/;

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (CODE_EXTENSIONS.test(path)) files.push(path);
  }
  return files;
}

/**
 * Variables validated by the Zod schema in `src/server/config.ts` are read as a whole
 * (`envSchema.safeParse(process.env)`), so they never appear as `process.env.NAME`. They are
 * collected from the schema keys instead.
 */
function validatedVariables(): string[] {
  const content = readFileSync('src/server/config.ts', 'utf8');
  return [...content.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]!);
}

function readVariables(): string[] {
  const found = new Set<string>(validatedVariables());
  for (const root of SCAN_ROOTS) {
    let files: string[];
    try {
      files = walk(root);
    } catch {
      continue;
    }
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.add(match[1]!);
    }
  }
  return [...found].sort();
}

function documentedVariables(): string[] {
  const content = readFileSync('.env.example', 'utf8');
  const keys = new Set<string>();
  for (const match of content.matchAll(/^#?\s?([A-Z][A-Z0-9_]*)=/gm)) keys.add(match[1]!);
  return [...keys].sort();
}

describe('environment variable documentation', () => {
  it('documents every variable read by the application', () => {
    const documented = new Set(documentedVariables());
    const undocumented = readVariables().filter((name) => !documented.has(name));
    expect(undocumented).toEqual([]);
  });

  it('finds the variables it is supposed to be checking', () => {
    // Guards against the scan silently matching nothing.
    const read = readVariables();
    expect(read).toContain('DATABASE_URL');
    expect(read).toContain('MIGRATIONS_FOLDER');
    expect(read).toContain('LOG_LEVEL');
    expect(documentedVariables()).toContain('POSTGRES_PASSWORD');
  });

  it('includes variables that are only validated through the schema', () => {
    expect(validatedVariables()).toContain('DATABASE_URL');
    expect(validatedVariables()).toContain('MARKET_DATA_PROVIDER');
  });

  it('reads no variable that is only meant for a test harness', () => {
    const read = readVariables();
    // These are process-level or test-only concerns; none should leak into application code.
    expect(read).not.toContain('NODE_OPTIONS');
    expect(read).not.toContain('HOME');
  });
});
