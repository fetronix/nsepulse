import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../../src/server/api/app.js';
import { closeDatabase } from '../../src/server/db/client.js';
import { openApi } from '../../src/server/api/openapi.js';

/**
 * The API documentation served at `/api/v1/docs` must describe exactly the routes the
 * application registers.
 *
 * This test exists because the served spec and the actual routes had drifted: `/health/live`
 * and `/health/ready` were registered and documented in `docs/openapi.yaml`, but were missing
 * from the spec the API actually returned. A spec that quietly omits endpoints is worse than
 * no spec, so the parity is asserted rather than assumed.
 */

const app = createApp({ quiet: true });

afterAll(async () => {
  await closeDatabase();
});

/** Collect `:param` route paths registered on the Express app, e.g. `/api/v1/quotes/:symbol`. */
function registeredPaths(): string[] {
  // Express 5 keeps the router on `app._router`; reading `app.router` throws a deprecation error.
  const router = (app as unknown as { _router?: { stack: unknown[] } })._router;
  const stack = router?.stack ?? [];
  const paths: string[] = [];

  const walk = (entries: unknown[]): void => {
    for (const entry of entries) {
      const layer = entry as {
        route?: { path: string | string[]; methods: Record<string, boolean> };
        handle?: { stack?: unknown[] };
      };
      if (layer.route) {
        const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of routePaths) {
          if (Object.keys(layer.route.methods ?? {}).length > 0) paths.push(path);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };

  walk(stack);
  return paths;
}

function normalise(path: string): string {
  return path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

describe('served OpenAPI document parity', () => {
  it('registers routes that can be enumerated for comparison', () => {
    expect(registeredPaths().length).toBeGreaterThan(5);
  });

  it('documents every registered API route', () => {
    const documented = new Set(Object.keys(openApi.paths));
    const missing = registeredPaths()
      .map(normalise)
      .filter((path) => path !== '/' && !documented.has(path));
    expect(missing).toEqual([]);
  });

  it('documents no route that is not registered', () => {
    const registered = new Set(registeredPaths().map(normalise));
    const phantom = Object.keys(openApi.paths).filter((path) => !registered.has(path));
    expect(phantom).toEqual([]);
  });

  it('serves the same document at /api/v1/docs', async () => {
    const response = await request(app).get('/api/v1/docs').expect(200);
    expect(Object.keys(response.body.paths).sort()).toEqual(Object.keys(openApi.paths).sort());
    expect(response.body.paths['/health/live']).toBeDefined();
    expect(response.body.paths['/health/ready']).toBeDefined();
  });

  it('describes readiness failure with a 503 response', async () => {
    const responses = Object.keys(openApi.paths['/health/ready']!.get.responses);
    expect(responses).toContain('503');
  });
});

/**
 * `docs/openapi.yaml` is the file humans read; `src/server/api/openapi.ts` is what the API
 * serves. Both were extended separately in the past and drifted, so their path sets are
 * compared here without adding a YAML dependency: this file uses a flat `paths:` block with
 * one two-space-indented key per path.
 */
describe('static YAML matches the served document', () => {
  it('lists the same paths in docs/openapi.yaml', () => {
    const yaml = readFileSync('docs/openapi.yaml', 'utf8');
    const pathLines = yaml
      .split('\n')
      .filter((line) => /^ {2}\/[A-Za-z0-9/{}_-]*:/.test(line))
      .map((line) => line.trim().replace(/:$/, ''));
    expect([...new Set(pathLines)].sort()).toEqual(Object.keys(openApi.paths).sort());
  });
});
