import { describe, expect, it } from 'vitest';
import { isStale, validateObservation } from '../../src/server/market/quality.js';

const base = {
  securityId: 'abc',
  symbol: 'TEST',
  price: 12,
  currency: 'KES' as const,
  source: 'fixture:test',
  marketEventAt: '2026-10-25T09:00:00Z',
  publishedAt: null,
  ingestedAt: '2026-10-25T09:05:00Z',
  dataMode: 'UNKNOWN' as const
};
const now = new Date('2026-10-25T10:00:00Z');

describe('market data quality guards', () => {
  it('accepts valid observations but keeps them unverified', () => {
    const result = validateObservation(base, now);
    expect(result.accepted).toBe(true);
    expect(result.observation?.validationStatus).toBe('UNVERIFIED');
    expect(result.reasons).toEqual([]);
  });

  it('accepts an observation with high, low, volume and previous close', () => {
    const result = validateObservation({ ...base, high: 13, low: 11, volume: 0, previousClose: 11.5, open: 11.8 }, now);
    expect(result.accepted).toBe(true);
  });

  it('rejects impossible prices, currency and ranges', () => {
    expect(validateObservation({ ...base, price: 0 }, now).accepted).toBe(false);
    expect(validateObservation({ ...base, price: -1 }, now).reasons).toEqual(
      expect.arrayContaining(['Price must be a finite positive number'])
    );
    expect(validateObservation({ ...base, price: Number.NaN }, now).accepted).toBe(false);
    expect(validateObservation({ ...base, currency: 'USD' as 'KES' }, now).reasons).toContain(
      'Unexpected currency; expected KES'
    );
    expect(validateObservation({ ...base, high: 4, low: 6 }, now).accepted).toBe(false);
  });

  it('requires identity, source and plausible ingestion time', () => {
    expect(validateObservation({ ...base, securityId: '' }, now).reasons).toContain('Missing security identity');
    expect(validateObservation({ ...base, symbol: '' }, now).reasons).toContain('Missing security identity');
    expect(validateObservation({ ...base, source: '  ' }, now).reasons).toContain('Source is required');
    expect(validateObservation({ ...base, ingestedAt: 'nonsense' }, now).reasons).toContain(
      'Invalid or future ingestion timestamp'
    );
    expect(validateObservation({ ...base, ingestedAt: '2026-10-25T11:00:00Z' }, now).reasons).toContain(
      'Invalid or future ingestion timestamp'
    );
  });

  it('rejects invalid published and market timestamps', () => {
    expect(validateObservation({ ...base, publishedAt: 'not-a-date' }, now).reasons).toContain(
      'Invalid publishedAt timestamp'
    );
    expect(validateObservation({ ...base, marketEventAt: 'not-a-date' }, now).reasons).toContain(
      'Invalid marketEventAt timestamp'
    );
  });

  it('rejects negative volume and non-positive price fields', () => {
    expect(validateObservation({ ...base, volume: -5 }, now).reasons).toContain('Volume must be non-negative');
    expect(validateObservation({ ...base, volume: Number.NaN }, now).accepted).toBe(false);
    for (const field of ['open', 'high', 'low', 'previousClose'] as const) {
      expect(validateObservation({ ...base, [field]: 0 }, now).reasons).toContain(`${field} must be positive`);
      expect(validateObservation({ ...base, [field]: -2 }, now).reasons).toContain(`${field} must be positive`);
    }
  });

  it('returns null observation with all reasons when rejected', () => {
    const result = validateObservation({ ...base, price: -1, currency: 'USD' as 'KES', source: '' }, now);
    expect(result.accepted).toBe(false);
    expect(result.observation).toBeNull();
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('staleness', () => {
  it('marks absent and old timestamps stale', () => {
    expect(isStale(null)).toBe(true);
    expect(isStale('2020-01-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))).toBe(true);
    expect(isStale('2026-10-25T10:00:00Z', new Date('2026-10-25T10:05:00Z'))).toBe(false);
  });

  it('treats future and malformed timestamps as stale rather than live', () => {
    expect(isStale('2027-01-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))).toBe(true);
    expect(isStale('not-a-date', new Date('2026-01-01T00:00:00Z'))).toBe(true);
  });

  it('honours a custom maximum age', () => {
    expect(isStale('2026-10-25T09:00:00Z', new Date('2026-10-25T10:00:00Z'), 30 * 60_000)).toBe(true);
    expect(isStale('2026-10-25T09:45:00Z', new Date('2026-10-25T10:00:00Z'), 30 * 60_000)).toBe(false);
    expect(isStale('2026-10-24T09:00:00Z', new Date('2026-10-25T10:00:00Z'))).toBe(true);
  });
});
