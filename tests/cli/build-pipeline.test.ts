import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regression tests for the production build pipeline.
 *
 * `vite build` writes to `dist/` and empties that directory first. `tsc -p
 * tsconfig.server.json` also writes to `dist/`. So if the server compilation runs *before*
 * the Vite build, `dist/server/**` is deleted and the container image ships without a server
 * bundle: `node dist/server/index.js` then fails with MODULE_NOT_FOUND.
 *
 * That is exactly what the Dockerfile used to do (`build:api && build`). These tests pin the
 * invariant so the ordering cannot silently regress again; the build job in CI additionally
 * asserts the artefacts exist after a real `npm run build:all`.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const dockerfile = readFileSync('Dockerfile', 'utf8');

describe('production build ordering', () => {
  it('defines build:all with the server compilation after the Vite build', () => {
    const script = pkg.scripts['build:all'];
    expect(script).toBeDefined();
    const viteIndex = script!.indexOf('vite build');
    const tscIndex = script!.indexOf('build:api');
    expect(viteIndex).toBeGreaterThanOrEqual(0);
    expect(tscIndex).toBeGreaterThan(viteIndex);
  });

  it('runs type checking as part of build:all', () => {
    expect(pkg.scripts['build:all']).toContain('typecheck');
  });

  it('keeps build:all as the last step of verify so artefacts exist afterwards', () => {
    const verify = pkg.scripts.verify!;
    expect(verify.trimEnd().endsWith('npm run build:all')).toBe(true);
    expect(verify).not.toMatch(/npm run build:api\s*&&\s*[^&]*npm run build$/);
  });

  it('uses build:all in the container build stage', () => {
    const buildStage = dockerfile.slice(0, dockerfile.indexOf('AS production-deps'));
    expect(buildStage).toContain('npm run build:all');
  });

  it('never compiles the server before the Vite build in the Dockerfile', () => {
    const buildStage = dockerfile.slice(0, dockerfile.indexOf('AS production-deps'));
    expect(buildStage).not.toMatch(/build:api\s*&&\s*npm run build\b/);
  });
});
