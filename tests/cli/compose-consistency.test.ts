import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Consistency between the documented local environment and the Compose stack.
 *
 * The README quick start is `cp .env.example .env && docker compose up -d db && npm run
 * db:migrate`. That only works if the password and database name in `.env.example` match the
 * ones `docker-compose.yml` creates — they did not (`change-me` vs `local_dev_only_change_me`),
 * so following the documented steps produced "password authentication failed".
 *
 * The compose file is parsed with targeted patterns rather than a YAML dependency. Each
 * extraction asserts it found something, so a restructuring of the file fails the test loudly
 * instead of silently matching nothing.
 */

const compose = readFileSync('docker-compose.yml', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');

function envValue(source: string, key: string): string {
  const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'));
  expect(match, `expected ${key}= in source`).not.toBeNull();
  return match![1]!.trim();
}

function composeDefault(key: string): string {
  const match = compose.match(new RegExp(`^\\s+${key}: \\$\\{${key}:-([^}]+)\\}`, 'm'));
  expect(match, `expected a default for ${key} in docker-compose.yml`).not.toBeNull();
  return match![1]!.trim();
}

describe('local environment matches the Compose database', () => {
  it('documents the Compose-only database credentials', () => {
    expect(envValue(envExample, 'POSTGRES_PASSWORD')).toBe(composeDefault('POSTGRES_PASSWORD'));
    expect(envValue(envExample, 'POSTGRES_DB')).toBe(composeDefault('POSTGRES_DB'));
  });

  it('uses a DATABASE_URL the Compose database would accept', () => {
    const url = new URL(envValue(envExample, 'DATABASE_URL'));
    expect(url.hostname).toBe('localhost');
    expect(url.port).toBe('5432');
    expect(decodeURIComponent(url.username)).toBe('nse_pulse');
    expect(decodeURIComponent(url.password)).toBe(composeDefault('POSTGRES_PASSWORD'));
    expect(url.pathname.replace(/^\//, '')).toBe(composeDefault('POSTGRES_DB'));
  });

  it('reaches the database by service name from inside the app container', () => {
    const match = compose.match(/^\s+DATABASE_URL:\s*(\S+)$/m);
    expect(match).not.toBeNull();
    const url = new URL(match![1]!.replace('${POSTGRES_PASSWORD', 'PLACEHOLDER${POSTGRES_PASSWORD'));
    // A container cannot reach a sibling service through localhost.
    expect(url.hostname).toBe('db');
    expect(url.hostname).not.toBe('localhost');
    expect(url.hostname).not.toBe('127.0.0.1');
  });

  it('documents the verified integration command in the Compose file', () => {
    expect(compose).toContain('npm run test:integration:verified');
  });

  it('keeps the database published on loopback only', () => {
    const published = [...compose.matchAll(/^\s+- '\d{1,3}(?:\.\d{1,3}){3}:\d+:(\d+)'$/gm)].map((m) => Number(m[1]));
    expect(published.length).toBeGreaterThan(0);
    // Every published port must be bound to 127.0.0.1, never 0.0.0.0.
    const bindings = [...compose.matchAll(/^\s+- '([^']+):\d+:\d+'$/gm)].map((m) => m[1]);
    expect(bindings.every((host) => host === '127.0.0.1')).toBe(true);
  });
});
