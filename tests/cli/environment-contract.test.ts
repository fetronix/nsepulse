import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Line-ending and runtime invariants.
 *
 * A Windows contributor reported `npm run format:check` failing on every file while the
 * committed source was already correctly formatted. The cause was not the code: Git for
 * Windows defaults to `core.autocrlf=true`, which converts the working tree to CRLF, and
 * Prettier is configured with `endOfLine: 'lf'`. Converting the same checkout back to LF
 * made all failures disappear with no content change.
 *
 * These tests assert the repository-level guarantees that keep formatting checks
 * reproducible, rather than relying on every contributor's local Git configuration.
 */

/** Extensions that are binary by nature; they must not be byte-scanned for CRLF. */
const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'ico',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'pdf',
  'zip',
  'gz'
]);

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

describe('line endings', () => {
  it('ships a .gitattributes that forces LF in every checkout', () => {
    const attributes = readFileSync('.gitattributes', 'utf8');
    // `text=auto eol=lf` is the rule that overrides core.autocrlf on Windows.
    expect(attributes).toMatch(/^\*\s+text=auto\s+eol=lf$/m);
    expect(attributes).toMatch(/^\*\.sh\s+text\s+eol=lf$/m);
  });

  it('keeps every tracked text file free of CRLF', () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      const extension = file.split('.').pop()?.toLowerCase() ?? '';
      if (BINARY_EXTENSIONS.has(extension)) continue;
      const bytes = readFileSync(file);
      // A NUL byte means binary content regardless of extension.
      if (bytes.includes(0)) continue;
      if (bytes.includes(0x0d)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('matches the Prettier configuration it is designed for', () => {
    // If someone relaxes endOfLine to 'auto', the .gitattributes guarantee would silently
    // stop being the thing that makes checks reproducible. Couple the two explicitly.
    const config = readFileSync('prettier.config.js', 'utf8');
    expect(config).toContain("endOfLine: 'lf'");
  });
});

describe('runtime version contract', () => {
  it('declares a Node range, pins the same range in .nvmrc and in CI', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      engines?: { node?: string };
    };
    const engines = pkg.engines?.node ?? '';
    expect(engines).toMatch(/>=22\.12\.0/);

    // .nvmrc is what a contributor actually runs; it must satisfy the declared range.
    const nvmrc = readFileSync('.nvmrc', 'utf8').trim();
    expect(engines).toContain(`<${Number(nvmrc) + 1}`);

    // CI must test the version the project actually supports.
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toMatch(new RegExp(`NODE_VERSION: '${nvmrc}'`));
  });

  it('enforces the engine range at install time instead of only warning', () => {
    // `engines` alone is advisory (npm prints EBADENGINE and continues), which lets an
    // unsupported runtime produce confusing downstream failures.
    expect(readFileSync('.npmrc', 'utf8')).toMatch(/^engine-strict=true$/m);
  });
});
