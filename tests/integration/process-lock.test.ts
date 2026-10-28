import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, tryAcquireProcessLock } from '../../src/server/db/client.js';

/**
 * Proves the single-poller guard against a real PostgreSQL instance.
 *
 * `tryAcquireProcessLock` holds a session-level advisory lock on a dedicated connection, which
 * is what stops a second replica (or an overlapping restart) from opening a competing Telegram
 * `getUpdates` loop. A mock would not demonstrate that, because the guarantee is the database's.
 *
 * Follows the same convention as the other integration suites: without TEST_DATABASE_URL the
 * file is skipped and reported as skipped. It previously ran unconditionally and failed with
 * "expected null not to be null" on any machine without a test database, contradicting the
 * contract in vitest.integration.config.ts. CI sets REQUIRE_INTEGRATION_TESTS=true, so a
 * genuinely missing database still fails there rather than skipping.
 */
const KEY = 731_502_611;
const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;

afterAll(async () => closeDatabase());

integration('process advisory lock', () => {
  it('grants the lock once and refuses a second holder', async () => {
    const first = await tryAcquireProcessLock(KEY);
    expect(first).not.toBeNull();

    const second = await tryAcquireProcessLock(KEY);
    expect(second).toBeNull();

    await first!();

    // Once released, another process (or a restarted one) can take it.
    const third = await tryAcquireProcessLock(KEY);
    expect(third).not.toBeNull();
    await third!();
  });

  it('keeps unrelated keys independent', async () => {
    const a = await tryAcquireProcessLock(KEY);
    const b = await tryAcquireProcessLock(KEY + 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    await a!();
    await b!();
  });

  it('is safe to release twice', async () => {
    const release = await tryAcquireProcessLock(KEY);
    expect(release).not.toBeNull();
    await release!();
    await expect(release!()).resolves.toBeUndefined();
    const again = await tryAcquireProcessLock(KEY);
    expect(again).not.toBeNull();
    await again!();
  });
});
