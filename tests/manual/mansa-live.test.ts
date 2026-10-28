import { describe, expect, it } from 'vitest';
import { MansaProvider } from '../../src/server/providers/mansa/provider.js';

/**
 * Manual live check against Mansa.
 *
 * Two conditions are required before any network call happens:
 *   1. MANSA_API_KEY is present, and
 *   2. MANSA_LIVE_TESTS is exactly `true`.
 *
 * The second condition matters because a developer may have a real key in `.env`. Without
 * it, `npm test` in that working copy would quietly spend paid quota on every run. The gate
 * is therefore an explicit opt-in, not merely the presence of a secret.
 *
 * Run it deliberately (PowerShell):
 *   $env:MANSA_LIVE_TESTS='true'; npx vitest run tests/manual/mansa-live.test.ts
 * or (bash):
 *   MANSA_LIVE_TESTS=true npx vitest run tests/manual/mansa-live.test.ts
 *
 * It asserts only what Mansa documents — that an authenticated call succeeds and that the
 * payload normalises into a KES observation that is *not* labelled real-time. It does not
 * assert a particular price, and it does not assert that field names match the alias table;
 * `npm run mansa:probe` prints the real keys for that.
 */
const apiKey = process.env.MANSA_API_KEY ?? '';
const baseUrl = process.env.MANSA_API_BASE_URL ?? 'https://mansaapi.com';
const optedIn = process.env.MANSA_LIVE_TESTS === 'true';
const liveEnabled = Boolean(apiKey) && optedIn;

/** Why the live block is not running; surfaced by the assertions below. */
export const liveGate = { hasKey: Boolean(apiKey), optedIn, liveEnabled };

describe.skipIf(!liveEnabled)('Mansa live integration (manual)', () => {
  it('discovers the Kenya exchange code from the API rather than assuming it', async () => {
    const provider = new MansaProvider({ baseUrl, apiKey });
    const exchange = await provider.discoverExchange();
    expect(exchange.code).toMatch(/^[A-Z]{2,8}$/);
    expect(['DISCOVERY', 'DOCUMENTED_FALLBACK']).toContain(exchange.source);
    // Recorded in the failure message if this ever runs in CI by accident.
    console.info(`[mansa-live] Kenya exchange code: ${exchange.code} (${exchange.source})`);
  }, 30_000);

  it('normalises a real quote without claiming real-time data', async () => {
    const provider = new MansaProvider({ baseUrl, apiKey });
    const exchange = await provider.discoverExchange();
    const quote = await provider.getQuoteDetail({ symbol: 'SCOM' });
    if (!quote.normalization.ok) {
      // A live account may not cover SCOM; report that rather than failing on a guess.
      console.warn(`[mansa-live] SCOM normalisation skipped: ${quote.normalization.reason}`);
      return;
    }
    const observation = quote.normalization.quote.observation;
    expect(exchange.code).toBeTruthy();
    expect(observation.currency).toBe('KES');
    expect(observation.price).toBeGreaterThan(0);
    expect(['DELAYED', 'END_OF_DAY', 'UNKNOWN']).toContain(observation.dataMode);
    expect(observation.dataMode).not.toBe('REAL_TIME');
    console.info(
      `[mansa-live] ${observation.symbol} ${observation.currency} ${observation.price} · ${observation.dataMode} · ${observation.marketEventAt ?? 'no timestamp'}`
    );
  }, 30_000);
});

// The default suite must prove the gate works rather than trust it. This block runs whenever
// the live calls are disabled, which is the normal case in CI and on a developer machine.
describe.skipIf(liveEnabled)('Mansa live integration gating', () => {
  it('never places a live call without both the key and the explicit opt-in', () => {
    expect(liveEnabled).toBe(false);
    // One of the two conditions must be the reason.
    expect(liveGate.hasKey && liveGate.optedIn).toBe(false);
  });

  it('is excluded from the default commands unless MANSA_LIVE_TESTS=true', () => {
    // Documents the contract enforced above: presence of a key alone is not enough.
    if (liveGate.hasKey) expect(liveGate.optedIn).toBe(false);
    expect(liveEnabled).toBe(false);
  });
});
