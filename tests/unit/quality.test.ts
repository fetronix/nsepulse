import { describe, expect, it } from 'vitest';
import { isStale, validateObservation } from '../../src/server/market/quality.js';
const base = { securityId: 'abc', symbol: 'TEST', price: 12, currency: 'KES' as const, source: 'fixture:test', marketEventAt: '2026-10-25T09:00:00Z', publishedAt: null, ingestedAt: '2026-10-25T09:05:00Z', dataMode: 'UNKNOWN' as const };
describe('market data quality guards', () => {
  it('accepts valid observations but keeps them unverified', () => {
    const result = validateObservation(base, new Date('2026-10-25T10:00:00Z'));
    expect(result.accepted).toBe(true);
    expect(result.observation?.validationStatus).toBe('UNVERIFIED');
  });
  it('rejects impossible prices, currency and ranges', () => {
    expect(validateObservation({ ...base, price: 0 }).accepted).toBe(false);
    expect(validateObservation({ ...base, currency: 'USD' as 'KES' }).reasons).toContain('Unexpected currency; expected KES');
    expect(validateObservation({ ...base, high: 4, low: 6 }).accepted).toBe(false);
  });
  it('marks absent and old timestamps stale', () => {
    expect(isStale(null)).toBe(true);
    expect(isStale('2020-01-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))).toBe(true);
    expect(isStale('2026-10-25T10:00:00Z', new Date('2026-10-25T10:05:00Z'))).toBe(false);
  });
});
