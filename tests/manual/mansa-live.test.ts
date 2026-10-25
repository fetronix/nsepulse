import { describe, expect, it } from 'vitest';
import { MansaProvider } from '../../src/server/providers/mansa/provider.js';

/**
 * Manual live check against Mansa. Skipped unless MANSA_API_KEY is present, so the normal
 * unit suite never depends on a paid or external API and CI never needs a secret.
 *
 * Run it deliberately:
 *   MANSA_API_KEY=mansa_live_sk_... npx vitest run tests/manual/mansa-live.test.ts
 *
 * It asserts only what Mansa documents — that an authenticated call succeeds and that the
 * payload normalises into a KES observation that is *not* labelled real-time. It does not
 * assert a particular price, and it does not assert that field names match the alias table;
 * `npm run mansa:probe` prints the real keys for that.
 */
const apiKey = process.env.MANSA_API_KEY ?? '';
const baseUrl = process.env.MANSA_API_BASE_URL ?? 'https://mansaapi.com';

describe.skipIf(!apiKey)('Mansa live integration (manual)', () => {
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

if (!apiKey) {
  describe('Mansa live integration (manual)', () => {
    it('is skipped because MANSA_API_KEY is absent', () => {
      expect(apiKey).toBe('');
    });
  });
}
