import { describe, expect, it } from 'vitest';
import {
  deriveFreshness,
  extractRecords,
  normalizeStockRecord,
  toDate,
  toFiniteNumber
} from '../../src/server/providers/mansa/normalize.js';

const NOW = new Date('2026-10-25T10:00:00.000Z');

/** Shape modelled on Mansa's documented ETF/index records in the same Markets namespace. */
const SNAPSHOT = {
  symbol: 'SCOM',
  name: 'Safaricom PLC',
  currency: 'KES',
  previous_close: 12.3,
  open: 12.4,
  high: 12.6,
  low: 12.2,
  close: 12.45,
  change_percentage: 1.22,
  volume: 1_500_000,
  value: 18_675_000,
  updated_at: '2026-10-25T09:55:00.000Z'
};

describe('normalizeStockRecord — successful mapping', () => {
  it('maps a documented-style record into the domain model and records field evidence', () => {
    const result = normalizeStockRecord(SNAPSHOT, { requestedSymbol: 'scom', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { observation, freshness, evidence } = result.quote;
    expect(observation).toMatchObject({
      symbol: 'SCOM',
      price: 12.45,
      currency: 'KES',
      previousClose: 12.3,
      open: 12.4,
      high: 12.6,
      low: 12.2,
      volume: 1_500_000,
      changePercent: 1.22,
      dataMode: 'DELAYED',
      validationStatus: 'UNVERIFIED',
      source: 'Mansa API (mansaapi.com)'
    });
    expect(observation.marketEventAt).toBe('2026-10-25T09:55:00.000Z');
    expect(freshness.ageMinutes).toBe(5);
    expect(freshness.stale).toBe(false);
    expect(evidence.find((item) => item.field === 'price')?.matched).toBe('close');
    expect(evidence.find((item) => item.field === 'symbol')?.matched).toBe('symbol');
  });

  it('accepts the camelCase aliases used elsewhere in Mansa responses', () => {
    const result = normalizeStockRecord(
      {
        ticker: 'EQTY',
        company_name: 'Equity Group Holdings',
        currency: 'KES',
        price: 48.7,
        changePercentage: -0.85,
        currentDateTime: '2026-10-25T09:40:00.000Z'
      },
      { requestedSymbol: 'EQTY', now: NOW }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.observation.price).toBe(48.7);
    expect(result.quote.observation.changePercent).toBe(-0.85);
    expect(result.quote.observation.volume).toBeNull();
    expect(result.quote.evidence.find((item) => item.field === 'price')?.matched).toBe('price');
  });

  it('accepts numeric strings, which JSON APIs commonly use for decimals', () => {
    const result = normalizeStockRecord(
      { symbol: 'KEGN', currency: 'KES', close: '7.1200', change_pct: '0.42' },
      { requestedSymbol: 'KEGN', now: NOW }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.observation.price).toBe(7.12);
    expect(result.quote.observation.changePercent).toBe(0.42);
  });

  it('derives percentage change only from the provider’s own previous close and says so', () => {
    const { change_percentage: _ignored, ...withoutChange } = SNAPSHOT;
    const result = normalizeStockRecord(withoutChange, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (12.45 - 12.30) / 12.30 = 1.2195%
    expect(result.quote.observation.changePercent).toBeCloseTo(1.2195, 3);
    expect(result.quote.notes.join(' ')).toMatch(/derived from price and previous close/);
  });

  it('applies KES only when the provider omitted currency, and says so', () => {
    const { currency: _omitted, ...withoutCurrency } = SNAPSHOT;
    const result = normalizeStockRecord(withoutCurrency, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.observation.currency).toBe('KES');
    expect(result.quote.notes.join(' ')).toMatch(/carried no currency/);
  });
});

describe('normalizeStockRecord — refusals', () => {
  it('rejects a record with no usable price instead of inventing one', () => {
    const { close: _dropped, ...withoutPrice } = SNAPSHOT;
    const result = normalizeStockRecord(withoutPrice, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('price');
    expect(result.reason).toMatch(/no quote was produced/i);
  });

  it.each([
    ['zero', 0],
    ['negative', -1.2],
    ['not a number', 'n/a']
  ])('rejects a %s price', (_label, price) => {
    const result = normalizeStockRecord({ ...SNAPSHOT, close: price }, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(false);
  });

  it('rejects a record with no ticker', () => {
    const { symbol: _dropped, ...withoutSymbol } = SNAPSHOT;
    const result = normalizeStockRecord(withoutSymbol, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('ticker');
  });

  it('rejects a record for a different ticker rather than relabelling it', () => {
    const result = normalizeStockRecord(SNAPSHOT, { requestedSymbol: 'EQTY', now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/returned "SCOM" when "EQTY" was requested/);
  });

  it('rejects a non-KES instrument instead of converting it', () => {
    const result = normalizeStockRecord({ ...SNAPSHOT, currency: 'NGN' }, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/only serves KES/);
  });

  it('rejects a high that is below the low', () => {
    const result = normalizeStockRecord({ ...SNAPSHOT, high: 1, low: 99 }, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/High is lower than low/);
  });

  it('rejects negative volume', () => {
    const result = normalizeStockRecord({ ...SNAPSHOT, volume: -5 }, { requestedSymbol: 'SCOM', now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toContain('volume');
  });

  it('rejects a non-object payload', () => {
    expect(normalizeStockRecord(null, { requestedSymbol: 'SCOM', now: NOW }).ok).toBe(false);
    expect(normalizeStockRecord([SNAPSHOT], { requestedSymbol: 'SCOM', now: NOW }).ok).toBe(false);
  });

  it('rejects a future observation timestamp rather than treating it as fresh', () => {
    const result = normalizeStockRecord(
      { ...SNAPSHOT, updated_at: '2026-10-26T10:00:00.000Z' },
      { requestedSymbol: 'SCOM', now: NOW }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/timestamp is in the future/i);
  });
});

describe('freshness and data-mode honesty', () => {
  it('never labels a provider snapshot REAL_TIME', () => {
    const fresh = deriveFreshness(new Date(NOW.getTime() - 60_000), NOW);
    expect(fresh.mode).toBe('DELAYED');
    expect(fresh.note).toMatch(/30-minute freshness target/);
    expect(fresh.note).toMatch(/not real-time/);
  });

  it('does not promote an older payload to a mode the documentation does not support', () => {
    const older = deriveFreshness(new Date(NOW.getTime() - 3 * 60 * 60_000), NOW);
    expect(older.mode).toBe('UNKNOWN');
    expect(older.stale).toBe(false);
    expect(older.ageMinutes).toBe(180);
  });

  it('marks a payload older than 24 hours as stale', () => {
    const stale = deriveFreshness(new Date(NOW.getTime() - 30 * 60 * 60_000), NOW);
    expect(stale.stale).toBe(true);
    expect(stale.mode).toBe('UNKNOWN');
    expect(stale.note).toMatch(/historical/);
  });

  it('reports UNKNOWN when there is no timestamp at all', () => {
    const missing = deriveFreshness(null, NOW);
    expect(missing).toMatchObject({ mode: 'UNKNOWN', ageMinutes: null, stale: true });
  });

  it('flags a future timestamp as unusable', () => {
    const future = deriveFreshness(new Date(NOW.getTime() + 60_000), NOW);
    expect(future.stale).toBe(true);
    expect(future.note).toMatch(/future/);
  });
});

describe('value parsing helpers', () => {
  it('parses numbers, numeric strings and rejects junk', () => {
    expect(toFiniteNumber(12.5)).toBe(12.5);
    expect(toFiniteNumber('1,234.50')).toBe(1234.5);
    expect(toFiniteNumber('  ')).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
  });

  it('parses ISO strings, epoch seconds and epoch milliseconds', () => {
    expect(toDate('2026-10-25T09:55:00.000Z')?.toISOString()).toBe('2026-10-25T09:55:00.000Z');
    expect(toDate(1_761_386_100)?.toISOString()).toBe('2025-10-25T09:55:00.000Z');
    expect(toDate(1_761_386_100_000)?.toISOString()).toBe('2025-10-25T09:55:00.000Z');
    expect(toDate('nonsense')).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });

  it('unwraps record collections from the shapes Mansa uses', () => {
    expect(extractRecords([{ a: 1 }])).toHaveLength(1);
    expect(extractRecords({ stocks: [{ a: 1 }, { a: 2 }] })).toHaveLength(2);
    expect(extractRecords({ data: [{ a: 1 }] })).toHaveLength(1);
    expect(extractRecords({ unrelated: [] })).toEqual([]);
    expect(extractRecords(null)).toEqual([]);
  });
});
