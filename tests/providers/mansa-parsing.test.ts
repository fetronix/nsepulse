import { describe, expect, it } from 'vitest';
import { selectKenyaExchange } from '../../src/server/providers/mansa/discovery.js';
import { toMoverQuotes } from '../../src/server/providers/mansa/movers.js';
import { findSnapshotRecord } from '../../src/server/providers/mansa/snapshot.js';
import { describeMansaStatus, mansaCapabilities } from '../../src/server/providers/mansa/descriptor.js';

/**
 * The parsing rules of the Mansa adapter, isolated from the HTTP client.
 *
 * Mansa publishes the record shapes as free-form objects, so these tests describe what the
 * adapter does with payloads it did not design: which keys it accepts, and — more
 * importantly — what it refuses to do when a field is missing. No network, no key.
 */
describe('exchange discovery', () => {
  it('finds Kenya by country name and records the evidence', () => {
    const result = selectKenyaExchange(
      { exchanges: [{ code: 'NSE', country: 'Kenya', name: 'Nairobi Securities Exchange' }] },
      'NSE'
    );
    expect(result.code).toBe('NSE');
    expect(result.source).toBe('DISCOVERY');
    expect(result.evidence).toContain('/api/v1/markets/exchanges');
  });

  it('does not treat a currency code alone as evidence of a Kenyan exchange', () => {
    // KES is one of the markers the adapter looks for, but a match also needs country or
    // exchange-name evidence. Currency alone falls back rather than guessing.
    const result = selectKenyaExchange({ data: [{ exchange_code: 'xna', currency: 'KES' }] }, 'NSE');
    expect(result.code).toBe('NSE');
    expect(result.source).toBe('DOCUMENTED_FALLBACK');
  });

  it('accepts a record whose country code and name both point at Nairobi', () => {
    const result = selectKenyaExchange(
      { data: [{ exchange_code: 'xna', country_code: 'KE', name: 'Nairobi Securities Exchange' }] },
      'NSE'
    );
    expect(result.code).toBe('XNA');
    expect(result.source).toBe('DISCOVERY');
  });

  it('never presents the fallback as a discovery', () => {
    const result = selectKenyaExchange({ exchanges: [{ code: 'LSE', country: 'United Kingdom' }] }, 'nse');
    expect(result.code).toBe('NSE');
    expect(result.source).toBe('DOCUMENTED_FALLBACK');
    expect(result.evidence).toContain('documented exchange code was used');
  });

  it('skips records with no usable code rather than inventing one', () => {
    const result = selectKenyaExchange(
      { exchanges: [{ country: 'Kenya' }, { code: '', country: 'Kenya' }, null, 'not-an-object'] },
      'NSE'
    );
    expect(result.source).toBe('DOCUMENTED_FALLBACK');
  });

  it('handles an empty or malformed payload without throwing', () => {
    for (const data of [null, {}, [], { exchanges: [] }]) {
      expect(selectKenyaExchange(data, 'NSE').source).toBe('DOCUMENTED_FALLBACK');
    }
  });
});

describe('snapshot lookup', () => {
  const records = [
    { symbol: 'SCOM', price: 12.5 },
    { ticker: 'eqty', price: 40 },
    { canonical_symbol: 'KCB', price: 35 }
  ];

  it('matches any of the documented symbol keys, case-insensitively', () => {
    expect(findSnapshotRecord(records, 'scom')).toEqual(records[0]);
    expect(findSnapshotRecord(records, 'EQTY')).toEqual(records[1]);
    expect(findSnapshotRecord(records, 'Kcb ')).toEqual(records[2]);
  });

  it('returns null for a symbol the snapshot does not hold', () => {
    expect(findSnapshotRecord(records, 'NOPE')).toBeNull();
    expect(findSnapshotRecord([], 'SCOM')).toBeNull();
  });

  it('ignores records without a symbol instead of matching them', () => {
    expect(findSnapshotRecord([{ price: 1 }, null], 'SCOM')).toBeNull();
  });
});

describe('mover mapping', () => {
  const now = new Date('2026-01-05T12:00:00.000Z');

  it('maps a complete record', () => {
    const [item] = toMoverQuotes(
      [{ symbol: 'scom', close: 12.5, change_percentage: 1.25, updated_at: '2026-01-05T11:55:00.000Z' }],
      { limit: 5, now }
    );
    expect(item).toBeDefined();
    expect(item).toEqual({
      symbol: 'SCOM',
      price: 12.5,
      changePercent: 1.25,
      currency: 'KES',
      marketEventAt: '2026-01-05T11:55:00.000Z',
      dataMode: expect.any(String)
    });
  });

  it('leaves an absent price absent rather than deriving it', () => {
    const [item] = toMoverQuotes([{ symbol: 'SCOM', changePercentage: 2 }], { limit: 5, now });
    expect(item?.price).toBeNull();
    expect(item?.marketEventAt).toBeNull();
  });

  it('treats a non-positive price as no price', () => {
    const [item] = toMoverQuotes([{ symbol: 'SCOM', close: 0 }], { limit: 5, now });
    expect(item?.price).toBeNull();
  });

  it('bounds the records it reads, and drops the ones with no symbol', () => {
    // The limit is applied to the provider records before symbol filtering, so a record with
    // no symbol consumes a slot instead of shifting extra rows into the response.
    const items = toMoverQuotes([{ close: 1 }, { symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }], { limit: 2, now });
    expect(items.map((i) => i.symbol)).toEqual(['A']);
  });

  it('keeps the provider order when every record is usable', () => {
    const items = toMoverQuotes([{ symbol: 'a' }, { symbol: 'b' }, { symbol: 'c' }], { limit: 2, now });
    expect(items.map((i) => i.symbol)).toEqual(['A', 'B']);
  });

  it('returns nothing for an empty payload', () => {
    expect(toMoverQuotes([], { limit: 5, now })).toEqual([]);
  });
});

describe('capabilities and status', () => {
  it('never claims a better access level than the documented 30-minute target', () => {
    const capabilities = mansaCapabilities();
    expect(capabilities.accessLevel).toBe('DELAYED');
    expect(capabilities.demo).toBe(false);
    expect(capabilities.coverage.notes.join(' ')).toContain('not from a successful authenticated response');
  });

  it('reports UNCONFIGURED without making a request', () => {
    const status = describeMansaStatus({
      configured: false,
      displayName: 'Mansa',
      lastSuccessAt: null,
      lastFailure: null
    });
    expect(status.state).toBe('UNCONFIGURED');
    expect(status.dataMode).toBe('UNKNOWN');
  });

  it('reports ERROR when the only attempt failed', () => {
    const status = describeMansaStatus({
      configured: true,
      displayName: 'Mansa',
      lastSuccessAt: null,
      lastFailure: 'HTTP 401'
    });
    expect(status.state).toBe('ERROR');
    expect(status.message).toContain('HTTP 401');
  });

  it('reports DEGRADED when configured but never verified', () => {
    const status = describeMansaStatus({
      configured: true,
      displayName: 'Mansa',
      lastSuccessAt: null,
      lastFailure: null
    });
    expect(status.state).toBe('DEGRADED');
    expect(status.message).toContain('no authenticated Mansa response has been verified');
  });

  it('reports READY only after a success, and still calls the data delayed', () => {
    const status = describeMansaStatus({
      configured: true,
      displayName: 'Mansa',
      lastSuccessAt: new Date('2026-01-05T12:00:00.000Z'),
      lastFailure: null
    });
    expect(status.state).toBe('READY');
    expect(status.dataMode).toBe('DELAYED');
    expect(status.message).toContain('not real-time');
    expect(status.lastSuccessAt).toBe('2026-01-05T12:00:00.000Z');
  });
});
